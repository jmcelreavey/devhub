/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { isDesktop } from "@/lib/desktop/bridge";
import { ReleaseNotesProvider, WhatsNewBanner, WhatsNewButton, ChangelogView } from "./ReleaseNotes";

vi.mock("@/lib/desktop/bridge", () => ({ isDesktop: vi.fn(() => false) }));
vi.mock("@/components/ui/SimpleMarkdown", () => ({ SimpleMarkdown: ({ text }: { text: string }) => <div>{text}</div> }));

const payload = { currentVersion: "2.0.5", releases: [
  { version: "Unreleased", date: null, markdown: "Not shipped", highlights: ["Not shipped"] },
  { version: "2.0.5", date: "2026-10-10", markdown: "- A release highlight", highlights: ["A release highlight"] },
  { version: "2.0.4", date: "2026-10-09", markdown: "- Previous release", highlights: ["Previous release"] },
] };

function mount(history = false) {
  return render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}><ReleaseNotesProvider><WhatsNewButton /><WhatsNewBanner />{history && <ChangelogView />}</ReleaseNotesProvider></SWRConfig>);
}

beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(false);
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("What's new", () => {
  it("doesn't interrupt a first launch and can be reopened", async () => {
    mount();
    await screen.findByText(/v2.0.5 ·/);
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("What's new in v2.0.5");
    expect(screen.getByRole("dialog")).toHaveTextContent("A release highlight");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Not shipped");
    expect(screen.getByRole("link", { name: "Full changelog" })).toHaveAttribute("href", "/changelog");
  });
  it.each([false, true])("persists banner dismissal and still allows a manual reopen (desktop=%s)", async (desktop) => {
    vi.mocked(isDesktop).mockReturnValue(desktop);
    const key = `devhub:release-notes:${desktop ? "desktop" : "web"}`;
    localStorage.setItem(key, JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    const mounted = mount();
    expect(await screen.findByRole("region", { name: "What's new in v2.0.5" })).toHaveTextContent("A release highlight");
    const close = screen.getByRole("button", { name: "Dismiss what's new" });
    expect(close).toHaveAttribute("title", "Dismiss what's new (Esc)");
    expect(close).toHaveClass("hub-icon-btn", "release-news-dismiss");
    fireEvent.click(close);
    expect(screen.queryByRole("region")).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ dismissed: ["2.0.5"] });
    mounted.unmount();
    mount();
    await screen.findByText(/v2.0.5 ·/);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
  it("dismisses the banner with Escape without interfering with another dialog", async () => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    mount();
    await screen.findByRole("region");
    const otherDialog = document.createElement("dialog");
    otherDialog.setAttribute("open", "");
    document.body.append(otherDialog);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("region")).toBeInTheDocument();
    otherDialog.remove();
    const hiddenMenu = document.createElement("div");
    hiddenMenu.setAttribute("role", "menu");
    hiddenMenu.setAttribute("hidden", "");
    document.body.append(hiddenMenu);
    const handledEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handledEscape.preventDefault();
    fireEvent(document, handledEscape);
    expect(screen.getByRole("region")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
    hiddenMenu.remove();
    expect(JSON.parse(localStorage.getItem("devhub:release-notes:web")!)).toMatchObject({ dismissed: ["2.0.5"] });
  });
  it.each(["Close", "Done", "Escape", "Full changelog"])("persists panel dismissal with %s and restores focus", async (action) => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    const mounted = mount();
    await screen.findByRole("region");
    const manualButton = screen.getByRole("button", { name: "What's new" });
    manualButton.focus();
    fireEvent.click(manualButton);
    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("region")).toBeNull();
    if (action === "Escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
    else if (action === "Full changelog") fireEvent.click(screen.getByRole("link", { name: action }));
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(manualButton).toHaveFocus();
    expect(JSON.parse(localStorage.getItem("devhub:release-notes:web")!)).toMatchObject({ dismissed: ["2.0.5"] });
    mounted.unmount();
    mount();
    await screen.findByText(/v2.0.5 ·/);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows a newer release once after dismissing the previous one", async () => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    const mounted = mount();
    await screen.findByRole("region");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss what's new" }));
    mounted.unmount();
    const newer = { ...payload, currentVersion: "2.0.6", releases: [{ version: "2.0.6", date: null, markdown: "- Newer highlight", highlights: ["Newer highlight"] }, ...payload.releases] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => newer })));
    const updated = mount();
    expect(await screen.findByRole("region", { name: "What's new in v2.0.6" })).toHaveTextContent("Newer highlight");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(JSON.parse(localStorage.getItem("devhub:release-notes:web")!)).toMatchObject({ dismissed: ["2.0.5", "2.0.6"] });
    updated.unmount();
    mount();
    await screen.findByText(/v2.0.6 ·/);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("has a loading state, readable error and working retry", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetcher);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(screen.getByRole("status", { name: "Loading release notes" })).toBeInTheDocument();
    await act(async () => pending.resolve({ ok: false } as Response));
    expect(await screen.findByText("Release notes couldn't be loaded.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("A release highlight"));
  });
  it("doesn't use Unreleased when the current release is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...payload, currentVersion: "9.0.0" }) })));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("No notes for this version yet")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Not shipped");
  });
  it("lists past releases and labels Unreleased separately", async () => {
    mount(true);
    expect(await screen.findByRole("heading", { name: "v2.0.4" })).toBeInTheDocument();
    expect(screen.getByText(/Not shipped in a release yet/).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Current version")).toBeInTheDocument();
  });
  it("offers an empty changelog state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ currentVersion: "2.0.5", releases: [] }) })));
    mount(true);
    expect(await screen.findByText("No releases listed yet")).toBeInTheDocument();
  });
});
