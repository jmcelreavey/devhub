// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentAgents } from "./PersistentAgents";
import { requestAgentConversation } from "@/lib/agent-handoff";

vi.mock("@/lib/desktop/bridge", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/desktop/bridge")>()), openInBrowser: vi.fn() }));
import { openInBrowser } from "@/lib/desktop/bridge";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const route = vi.hoisted(() => ({ pathname: "/agents", query: "conversation=first" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.query) }));
beforeEach(() => {
  route.pathname = "/agents"; route.query = "conversation=first";
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/api/paseo/open") ? { url: "http://localhost:6767/h/srv/workspace/wks?open=agent%3Afirst" } : { connected: true, origin: "http://127.0.0.1:6767" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("persistent Agents", () => {
  it("does not connect to Paseo when opening Usage directly", () => {
    route.query = "view=usage";
    render(<PersistentAgents />);
    expect(screen.queryByTitle("Agents — Paseo")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("hides the existing chat for Usage and preserves it when returning", async () => {
    const view = render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo");
    await waitFor(() => expect(frame.getAttribute("src")).toContain("open=agent%3Afirst"));
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals");
    route.query = "view=usage";
    view.rerender(<PersistentAgents />);
    expect(frame.closest("section")).toHaveAttribute("hidden");
    route.query = "";
    view.rerender(<PersistentAgents />);
    expect(screen.getByTitle("Agents — Paseo")).toBe(frame);
    expect(frame.closest("section")).not.toHaveAttribute("hidden");
    expect(frame.getAttribute("src")).toContain("open=agent%3Afirst");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("passes the configured password only to the local Paseo frame", async () => {
    route.query = "";
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => ({ ok: true, json: async () => String(url).includes("/bootstrap") ? { serverId: "srv_test", password: "test-secret" } : { connected: true, origin: "http://127.0.0.1:6767" } } as Response));
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    await act(async () => window.dispatchEvent(new MessageEvent("message", { origin: "http://localhost:6767", source: frame.contentWindow, data: { type: "devhub:paseo:ready" } })));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "devhub:paseo:credentials", serverId: "srv_test", password: "test-secret", bridgeConfirm: false }, "http://localhost:6767"));
    expect(fetch).toHaveBeenCalledWith("/api/agent/connection/bootstrap", expect.objectContaining({ method: "POST" }));
  });
  it("answers Paseo's confirm prompts from the Paseo frame only", async () => {
    route.query = "";
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    const data = { type: "devhub:paseo:confirm", id: 7, message: "Archive project?\n\nIts worktrees will be removed." };
    await act(async () => window.dispatchEvent(new MessageEvent("message", { origin: "http://attacker.test", source: frame.contentWindow, data })));
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new MessageEvent("message", { origin: "http://localhost:6767", source: frame.contentWindow, data })));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "devhub:paseo:confirm-result", id: 7, ok: true }, "http://localhost:6767"));
    expect(confirm).toHaveBeenCalledWith("Its worktrees will be removed.");
  });
  it("opens links from the Paseo frame in the system browser, and nobody else's", async () => {
    route.query = "";
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo") as HTMLIFrameElement;
    const send = (init: { origin: string; source?: MessageEventSource | null; url?: unknown }) =>
      act(async () => window.dispatchEvent(new MessageEvent("message", { origin: init.origin, source: init.source ?? frame.contentWindow, data: { type: "devhub:paseo:open-link", url: init.url } })));
    await send({ origin: "http://attacker.test", url: "https://example.com/a" });
    await send({ origin: "http://localhost:6767", source: window, url: "https://example.com/b" });
    await send({ origin: "http://localhost:6767", url: 42 });
    await send({ origin: "http://localhost:6767", url: `https://example.com/${"x".repeat(5000)}` });
    expect(openInBrowser).not.toHaveBeenCalled();
    await send({ origin: "http://localhost:6767", url: "https://example.com/pull/1" });
    expect(openInBrowser).toHaveBeenCalledExactlyOnceWith("https://example.com/pull/1");
  });
  it("preserves the selected chat and frame when background data changes and a page is revisited", async () => {
    const view = render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo");
    await waitFor(() => expect(frame.getAttribute("src")).toBe("http://localhost:6767/h/srv/workspace/wks?open=agent%3Afirst"));
    // Paseo moved to a different chat internally; DevHub must not reapply its old link.
    frame.setAttribute("src", "http://localhost:6767/h/srv_x/workspace/selected-inside-paseo");
    route.pathname = "/notes"; route.query = "";
    view.rerender(<PersistentAgents />);
    route.pathname = "/agents"; route.query = "conversation=first";
    view.rerender(<PersistentAgents />);
    expect(screen.getByTitle("Agents — Paseo")).toBe(frame);
    expect(frame.getAttribute("src")).toContain("selected-inside-paseo");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("allows an explicit Open chat action to select the same linked chat again", async () => {
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo");
    await waitFor(() => expect(frame.getAttribute("src")).toBe("http://localhost:6767/h/srv/workspace/wks?open=agent%3Afirst"));
    frame.setAttribute("src", "http://localhost:6767/h/srv_x/workspace/other");
    act(() => requestAgentConversation("first"));
    await waitFor(() => expect(frame.getAttribute("src")).toBe("http://localhost:6767/h/srv/workspace/wks?open=agent%3Afirst"));
  });
  it("keeps Paseo usable when an old task chip has no chat", async () => {
    route.query = "run=run-old-12345678";
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ connected: true, origin: "http://127.0.0.1:6767" }) } as Response);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "This chat was created before the move to Paseo." }) } as Response);
    render(<PersistentAgents />);
    expect(await screen.findByRole("alert")).toHaveTextContent("before the move to Paseo");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(router.replace).toHaveBeenCalledWith("/agents");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTitle("Agents — Paseo").getAttribute("src")).toBe("http://localhost:6767/");
  });
  it("does not navigate away after the user leaves while a run link loads", async () => {
    route.query = "run=run-old-12345678";
    let resolveRun!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ connected: true, origin: "http://127.0.0.1:6767" }) } as Response);
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRun = resolve; }));
    const view = render(<PersistentAgents />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    route.pathname = "/notes"; route.query = "";
    view.rerender(<PersistentAgents />);
    await act(async () => resolveRun({ ok: true, json: async () => ({ run: { runtime: "aionui" } }) } as Response));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
  });
  it("opens a task chip's run straight in its chat", async () => {
    route.query = "run=run-abc-12345678";
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — Paseo");
    await waitFor(() => expect(frame.getAttribute("src")).toBe("http://localhost:6767/h/srv/workspace/wks?open=agent%3Afirst"));
  });
});
