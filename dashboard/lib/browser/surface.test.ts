import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedBrowser } from "./runtime";
import { BrowserLease } from "./lease";
import { BrowserSurface, TRANSFER_LIMIT } from "./surface";

function fixture() {
  const page = Object.assign(new EventEmitter(), { url: (): string => "https://example.com/form", isClosed: () => false, close: vi.fn(), mainFrame: () => null });
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string) => method === "Fetch.takeResponseBodyAsStream" ? { stream: "body" } : method === "IO.read" ? { data: "approved file", eof: true } : {}),
    detach: vi.fn(async () => undefined),
  });
  const session = {
    page, context: Object.assign(new EventEmitter(), { newCDPSession: async () => cdp }),
    view: { id: "session", origins: ["https://example.com"] }, lease: new BrowserLease(),
    handles: new Map(), controller: new AbortController(),
  } as unknown as ManagedBrowser;
  const surface = new BrowserSurface(session);
  return { page, cdp, session, surface };
}
function attachment(cdp: EventEmitter, length?: number) {
  cdp.emit("Fetch.requestPaused", {
    requestId: "download-request", request: { url: "https://example.com/file" }, responseStatusCode: 200,
    responseHeaders: [{ name: "content-type", value: "application/octet-stream" }, { name: "content-disposition", value: 'attachment; filename="report.txt"' }, ...(length ? [{ name: "content-length", value: String(length) }] : [])],
  });
}
describe("file approval lifecycle", () => {
  it("refreshes popup details when navigation finishes during CDP setup", async () => {
    const { surface, page, session, cdp } = fixture();
    cdp.send.mockImplementation(async () => {
      page.url = () => "https://example.com/popup";
      return {};
    });
    await surface.initialise();
    expect(session.view.tabs?.[0].url).toBe("https://example.com/popup");
    await surface.dispose();
  });
  it("names the actual upload frame and rejects a changed or unapproved frame", async () => {
    const { surface, page, session } = fixture(); await surface.initialise();
    session.view.origins.push("https://uploads.example.com");
    let url = "https://uploads.example.com/form";
    const setFiles = vi.fn(async () => undefined);
    const element = { evaluate: vi.fn(async () => true), ownerFrame: async () => ({ url: () => url }) };
    page.emit("filechooser", { element: () => element, setFiles });
    await vi.waitFor(() => expect(session.view.transfer?.origin).toBe("https://uploads.example.com"));
    const id = session.view.transfer!.id;
    url = "https://uploads.example.com/other";
    await expect(surface.upload(id, { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") })).rejects.toThrow("frame changed");
    expect(setFiles).not.toHaveBeenCalled();
    url = "https://unapproved.example.com";
    page.emit("filechooser", { element: () => element, setFiles });
    await vi.waitFor(() => expect(session.view.notice).toContain("frames on approved sites"));
    expect(session.view.transfer).toBeUndefined();
    await surface.dispose();
  });
  afterEach(() => vi.useRealTimers());
  it("does not read a paused body until approved, consumes approval once and never resumes a native download", async () => {
    const { surface, session, cdp } = fixture(); await surface.initialise();
    attachment(cdp);
    expect(session.view.transfer?.kind).toBe("download");
    expect(cdp.send).not.toHaveBeenCalledWith("Fetch.takeResponseBodyAsStream", expect.anything());
    const id = session.view.transfer!.id;
    expect((await surface.download(id)).toString()).toBe("approved file");
    expect(cdp.send).toHaveBeenCalledWith("Fetch.failRequest", { requestId: "download-request", errorReason: "Aborted" });
    await expect(surface.download(id)).rejects.toThrow("expired");
    await surface.dispose();
  });
  it("rejects oversized responses and expires pending approvals without reading them", async () => {
    vi.useFakeTimers();
    const { surface, session, cdp } = fixture(); await surface.initialise();
    attachment(cdp, TRANSFER_LIMIT + 1);
    expect(session.view.transfer).toBeUndefined();
    attachment(cdp);
    expect(session.view.transfer).toBeDefined();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(session.view.transfer).toBeUndefined();
    expect(cdp.send).not.toHaveBeenCalledWith("Fetch.takeResponseBodyAsStream", expect.anything());
    await surface.dispose();
  });
  it("checks the running byte count even when content-length is absent", async () => {
    const { surface, session, cdp } = fixture(); await surface.initialise();
    const send = cdp.send;
    send.mockImplementation(async (method: string) => method === "Fetch.takeResponseBodyAsStream" ? { stream: "body" } : method === "IO.read" ? { data: "x".repeat(TRANSFER_LIMIT + 1), eof: true } : {});
    attachment(cdp);
    const id = session.view.transfer!.id;
    await expect(surface.download(id)).rejects.toThrow("20 MiB");
    expect(send).toHaveBeenCalledWith("IO.close", { handle: "body" });
    await surface.dispose();
  });
  it("requires human control and a live exact file input before sending bytes", async () => {
    const { surface, page, session } = fixture(); await surface.initialise();
    const setFiles = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => true);
    page.emit("filechooser", { element: () => ({ evaluate, ownerFrame: async () => ({ url: () => page.url() }) }), setFiles });
    await vi.waitFor(() => expect(session.view.transfer?.kind).toBe("upload"));
    const id = session.view.transfer!.id;
    session.lease.grant();
    await expect(surface.upload(id, { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") })).rejects.toThrow("Human");
    expect(setFiles).not.toHaveBeenCalled();
    await session.lease.takeover();
    evaluate.mockResolvedValue(false);
    await expect(surface.upload(id, { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") })).rejects.toThrow("changed");
    expect(setFiles).not.toHaveBeenCalled();
    await surface.dispose();
  });
});
