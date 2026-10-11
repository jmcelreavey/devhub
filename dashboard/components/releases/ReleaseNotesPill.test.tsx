/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { isDesktop } from "@/lib/desktop/bridge";
import { openReleaseNotes } from "@/lib/release-notes";
import { ReleaseNotesProvider, ReleaseNotesAbout, WhatsNewBanner, WhatsNewPill } from "./ReleaseNotes";

vi.mock("@/lib/desktop/bridge", () => ({ isDesktop: vi.fn(() => false) }));
vi.mock("@/components/ui/SimpleMarkdown", () => ({ SimpleMarkdown: ({ text }: { text: string }) => <div>{text}</div> }));

const payload = { currentVersion: "2.0.5", releases: [
  { version: "2.0.5", date: "2026-10-10", markdown: "- A release highlight", highlights: ["A release highlight"] },
] };

function mount(compact = false, about = false) {
  return render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}><ReleaseNotesProvider><aside><WhatsNewPill compact={compact} /><button className="sidebar-collapse-btn">Toggle sidebar</button></aside><WhatsNewBanner />{about && <ReleaseNotesAbout />}</ReleaseNotesProvider></SWRConfig>);
}

beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(false);
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function settleObservation() {
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
}

describe("What's new sidebar pill", () => {
  it.each([false, true])("hides the pill and panel permanently for this version (desktop=%s)", async (desktop) => {
    vi.mocked(isDesktop).mockReturnValue(desktop);
    const key = `devhub:release-notes:${desktop ? "desktop" : "web"}`;
    localStorage.setItem(key, JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    const mounted = mount();
    const pill = await screen.findByRole("group", { name: "What's new notification" });
    await screen.findByRole("region");
    const hide = within(pill).getByRole("button", { name: "Hide What's new for v2.0.5" });
    expect(hide).toHaveAttribute("title", "Hide What's new for v2.0.5");
    expect(hide.parentElement?.closest("button")).toBeNull();
    fireEvent.focus(hide);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hide What's new for v2.0.5");
    fireEvent.click(hide);
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ dismissed: ["2.0.5"] });
    mounted.unmount();
    mount();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await settleObservation();
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    act(() => openReleaseNotes());
    expect(await screen.findByRole("dialog")).toHaveTextContent("What's new in v2.0.5");
  });
  it.each([false, true])("has separate keyboard actions in both sidebar states (compact=%s)", async (compact) => {
    const user = userEvent.setup();
    mount(compact);
    const pill = await screen.findByRole("group", { name: "What's new notification" });
    expect(pill.classList.contains("release-version-pill-compact")).toBe(compact);
    const open = within(pill).getByRole("button", { name: "What's new" });
    expect(open.textContent).toBe(compact ? "" : "v2.0.5 · What's new");
    open.focus();
    await user.keyboard("{Tab}{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
  });
  it.each(["banner", "Close", "Done", "Escape", "Full changelog"])("also hides the pill when dismissing via %s", async (action) => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.4", seen: ["2.0.4"] }));
    mount();
    const pill = await screen.findByRole("group", { name: "What's new notification" });
    await screen.findByRole("region");
    if (action === "banner") fireEvent.click(screen.getByRole("button", { name: "Dismiss what's new" }));
    else {
      fireEvent.click(within(pill).getByRole("button", { name: "What's new" }));
      const dialog = await screen.findByRole("dialog");
      if (action === "Escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
      else if (action === "Full changelog") fireEvent.click(screen.getByRole("link", { name: action }));
      else fireEvent.click(screen.getByRole("button", { name: action }));
    }
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(JSON.parse(localStorage.getItem("devhub:release-notes:web")!)).toMatchObject({ dismissed: ["2.0.5"] });
  });
  it("restores the pill for a new version without reviving an older dismissal", async () => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.5", seen: ["2.0.5"], dismissed: ["2.0.5"] }));
    const newer = { ...payload, currentVersion: "2.0.6", releases: [{ version: "2.0.6", date: null, markdown: "- Newer highlight", highlights: ["Newer highlight"] }, ...payload.releases] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => newer })));
    const mounted = mount();
    const hide = await screen.findByRole("button", { name: "Hide What's new for v2.0.6" });
    expect(await screen.findByRole("region")).toHaveTextContent("Newer highlight");
    fireEvent.click(hide);
    mounted.unmount();
    mount();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await settleObservation();
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("devhub:release-notes:web")!)).toMatchObject({ dismissed: ["2.0.5", "2.0.6"] });
  });
  it("doesn't flash a pill for an existing dismissal while loading", async () => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.5", seen: ["2.0.5"], dismissed: ["2.0.5"] }));
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    mount();
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    await act(async () => pending.resolve({ ok: true, json: async () => payload } as Response));
    await settleObservation();
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
  });
  it("hides in the current session even when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Hide What's new for v2.0.5" }));
    expect(screen.queryByRole("group", { name: "What's new notification" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps About's version, changelog and manual reopen available after dismissal", async () => {
    localStorage.setItem("devhub:release-notes:web", JSON.stringify({ lastVersion: "2.0.5", seen: ["2.0.5"], dismissed: ["2.0.5"] }));
    mount(false, true);
    const about = screen.getByRole("region", { name: "About" });
    expect(await within(about).findByRole("link", { name: "Changelog for v2.0.5" })).toHaveAttribute("href", "/changelog");
    expect(within(about).getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
    fireEvent.click(within(about).getByRole("button", { name: "What's new" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("A release highlight");
  });
});
