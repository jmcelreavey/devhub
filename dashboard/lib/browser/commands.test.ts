import { randomUUID, createHash } from "node:crypto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { BrowserLease } from "./lease";
import type { ManagedBrowser } from "./runtime";
const fixture = vi.hoisted(() => ({ session: undefined as unknown }));
vi.mock("./runtime", () => ({ currentBrowser: () => fixture.session, assertBrowserRun: vi.fn() }));
import { approveBrowserAction, browserScreenshot, browserCredential, resumeBrowser, takeBrowserControl } from "./commands";
describe("browser action proposals", () => {
  let session: ManagedBrowser;
  const click = vi.fn(); const fill = vi.fn(); const screenshot = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    const lease = new BrowserLease(); lease.grant();
    const target = randomUUID(); const observation = randomUUID();
    const html = "<button>Send</button>";
    const handle = { evaluate: vi.fn().mockResolvedValueOnce(html).mockResolvedValue(false), click, fill, dispose: vi.fn().mockResolvedValue(undefined) };
    session = {
      lease, controller: new AbortController(), signatures: new Map([[target, createHash("sha256").update(html).digest("hex")]]), handles: new Map([[target, handle]]),
      page: { url: () => "https://example.com/", locator: () => ({ count: async () => 0 }), screenshot },
      observation: { id: observation, url: "https://example.com/", text: "", at: Date.now(), elements: [{ id: target, role: "button", name: "Send" }] },
      view: { id: randomUUID(), taskId: "task", runId: "run", origins: ["https://example.com"], pending: { id: randomUUID(), expiresAt: Date.now() + 60000, url: "https://example.com/", action: { kind: "click", target, observation } } },
    } as unknown as ManagedBrowser;
    fixture.session = session;
  });
  it("consumes approval once and runs only its exact element", async () => {
    const id = session.view.pending!.id;
    await approveBrowserAction(session.view.id, id);
    expect(click).toHaveBeenCalledOnce(); expect(fill).not.toHaveBeenCalled();
    await expect(approveBrowserAction(session.view.id, id)).rejects.toThrow();
    expect(click).toHaveBeenCalledOnce();
  });
  it("refuses stale element evidence without dispatch", async () => {
    session.signatures.clear();
    const result = await approveBrowserAction(session.view.id, session.view.pending!.id);
    expect(result?.status).toBe("failed"); expect(click).not.toHaveBeenCalled();
  });
  it("rejects an expired proposal and mismatched owner", async () => {
    session.view.pending!.expiresAt = Date.now() - 1;
    await expect(approveBrowserAction(session.view.id, session.view.pending!.id)).rejects.toThrow();
    expect(() => browserCredential("wrong-task", "run")).toThrow();
    expect(() => browserCredential("task", "wrong-run")).toThrow();
  });
  it("a takeover during resume inspection cannot re-enable automation", async () => {
    let release!: (value: number) => void;
    const gate = new Promise<number>((resolve) => { release = resolve; });
    session.page.locator = vi.fn().mockReturnValue({ count: () => gate });
    const resume = resumeBrowser(session.view.id);
    const rejected = expect(resume).rejects.toThrow("control changed");
    await Promise.resolve(); await Promise.resolve();
    await takeBrowserControl(session.view.id);
    release(0); await rejected;
    expect(session.lease.mode).toBe("human");
  });
  it("never captures while human control is active", async () => {
    await session.lease.takeover();
    await expect(browserScreenshot(session.view.id)).rejects.toThrow();
    expect(screenshot).not.toHaveBeenCalled();
  });
  it("records an uncertain input without replaying it", async () => {
    click.mockRejectedValueOnce(new Error("Connection lost"));
    const result = await approveBrowserAction(session.view.id, session.view.pending!.id);
    expect(result?.status).toBe("unknown"); expect(click).toHaveBeenCalledOnce(); expect(session.view.pending).toBeUndefined();
  });
});
