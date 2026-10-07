// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  tabs: { history: [], openHref: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/work",
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/shell/WorkspaceTabs", () => ({ useWorkspaceTabs: () => mocks.tabs }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: null }) }));
vi.mock("@/lib/hooks/use-is-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => mocks.toast }));

function response(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

const notes = [
  { type: "file", path: "guides/widget-alpha.json", name: "Widget alpha" },
  { type: "file", path: "guides/widget-beta.json", name: "Widget beta" },
];
const repos = Array.from({ length: 45 }, (_, index) => ({
  name: `Widget ${index}`, path: `/repos/widget-${index}`, branch: "main", dirtyCount: 0, unpushedCount: 0,
}));
const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

function setupFetch(
  search: (query: string, signal: AbortSignal | null | undefined) => Promise<Response> = async () => response({ files: [] }),
  docs: unknown = {},
) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/search") return search(url.searchParams.get("q") ?? "", init?.signal);
    if (url.pathname === "/api/docs/search") return Promise.resolve(response(docs));
    if (url.pathname === "/api/tree") return Promise.resolve(response(notes));
    if (url.pathname === "/api/repos") return Promise.resolve(response({ repos }));
    return Promise.resolve(response({}));
  }));
}

async function openPalette() {
  const onClose = vi.fn();
  await act(async () => { render(<CommandPalette open onClose={onClose} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return { input: screen.getByRole("combobox", { name: "Search DevHub" }), onClose };
}

async function searchFor(input: HTMLElement, query: string) {
  fireEvent.change(input, { target: { value: query } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CommandPalette", () => {
  it("ignores an older content response arriving after the newer search", async () => {
    const oldRequest = deferredResponse();
    const newRequest = deferredResponse();
    let oldSignal: AbortSignal | null | undefined;
    setupFetch((query, signal) => {
      if (query === "oldphrase") { oldSignal = signal; return oldRequest.promise; }
      return newRequest.promise;
    });
    const { input } = await openPalette();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    await searchFor(input, "oldphrase");
    await searchFor(input, "newphrase");
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      newRequest.resolve(response({ files: [{ path: "new-result.json", matches: [{ text: "New result body" }] }] }));
    });
    expect(screen.getByRole("option", { name: /new-result/ })).toBeInTheDocument();
    await act(async () => {
      oldRequest.resolve(response({ files: [{ path: "old-result.json", matches: [{ text: "Old result body" }] }] }));
    });

    expect(screen.queryByRole("option", { name: /old-result/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /new-result/ })).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  });

  it("clears immediately and cannot repopulate results from the pending request", async () => {
    const pending = deferredResponse();
    let requestSignal: AbortSignal | null | undefined;
    setupFetch((_query, signal) => { requestSignal = signal; return pending.promise; });
    const { input } = await openPalette();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    await searchFor(input, "pendingphrase");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(response({ files: [{ path: "stale-result.json", matches: [{ text: "Stale" }] }] }));
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Search inside your content")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  });

  it("keeps successful source hits visible after a partial failure and recovers on retry", async () => {
    const search = vi.fn()
      .mockRejectedValueOnce(new Error("Notes search unavailable"))
      .mockResolvedValueOnce(response({ files: [{ path: "recovered-note.json", matches: [{ text: "Recovered note body" }] }] }));
    setupFetch(search, {
      results: [{ slug: "guide", title: "Available guide", href: "/docs/guide", matches: [] }],
    });
    const { input } = await openPalette();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    await searchFor(input, "recovery");

    expect(screen.getByRole("option", { name: /Available guide/ })).toBeInTheDocument();
    expect(screen.getByText("Some content couldn’t be searched.")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("option", { name: /Available guide/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /recovered-note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  });

  it("finds notes outside the first forty all-source matches when switching scope", async () => {
    setupFetch();
    const { input } = await openPalette();
    await searchFor(input, "widget");
    expect(screen.queryByRole("option", { name: /Widget alpha/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Widget alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
  });

  it("scrolls keyboard selection into view and opens Shift+Enter in a new workspace tab", async () => {
    setupFetch();
    const { input, onClose } = await openPalette();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    scrollIntoView.mockClear();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const selected = screen.getByRole("option", { name: /Widget beta/ });

    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", selected.id);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(selected);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mocks.tabs.openHref).toHaveBeenCalledWith("/notes/guides/widget-beta", { newTab: true });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
