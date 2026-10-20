/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesBoard } from "./notes-board-shared";
import { useProfileWork } from "./use-profile-work";
import { useSidebarCounts } from "@/lib/hooks/use-sidebar-counts";

const board = (generatedAt: string, errors: string[] = []): NotesBoard => ({ generatedAt, errors, cards: [], columns: [], hiddenDone: 0 });
const fetchMock = vi.fn();
function wrapper({ children }: { children: ReactNode }) { return <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>; }

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("profile-keyed work reads", () => {
  it("retains the last complete board on a partial source failure", async () => {
    let partial = false;
    fetchMock.mockImplementation(async (key: string) => Response.json(key === "/api/tasks/profiles" ? { active: "work" } : key.startsWith("/api/storyboard") ? board(partial ? "partial" : "complete", partial ? ["Unreadable note"] : []) : { items: [] }));
    const { result } = renderHook(() => useProfileWork(), { wrapper });
    await waitFor(() => expect(result.current.board.data?.generatedAt).toBe("complete"));
    partial = true;
    await act(async () => { await result.current.board.mutate(); });
    await waitFor(() => expect(result.current.board.error).toBeTruthy());
    expect(result.current.board.data?.generatedAt).toBe("complete");
  });

  it("never serves an old in-flight profile response as the newly selected profile", async () => {
    let resolveWork!: (response: Response) => void;
    fetchMock.mockImplementation((key: string) => {
      if (key === "/api/tasks/profiles") return Promise.resolve(Response.json({ active: "work" }));
      if (key === "/api/storyboard?taskProfile=work") return new Promise<Response>((resolve) => { resolveWork = resolve; });
      return Promise.resolve(Response.json(key.startsWith("/api/storyboard") ? board("home") : { items: [] }));
    });
    const { result } = renderHook(() => useProfileWork(), { wrapper });
    await waitFor(() => expect(resolveWork).toBeTypeOf("function"));
    await act(async () => { await result.current.profile.mutate({ mode: "profiles", active: "home", profiles: ["home", "work"], legacyFiles: 0, overlay: [] }, { revalidate: false }); });
    await waitFor(() => expect(result.current.board.data?.generatedAt).toBe("home"));
    await act(async () => { resolveWork(Response.json(board("work"))); });
    expect(result.current.profileId).toBe("home");
    expect(result.current.board.data?.generatedAt).toBe("home");
  });

  it("keeps last-known peer reviews when GitHub authentication becomes unavailable", async () => {
    let configured = true;
    fetchMock.mockImplementation(async (key: string) => Response.json(key === "/api/tasks/profiles" ? { active: "work" }
      : key.startsWith("/api/github/prs") ? { configured, authored: [], reviews: configured ? [{ repo: "acme/app", number: 42, title: "Peer change" }] : [], recentlyReviewed: [] }
      : key.startsWith("/api/storyboard") ? board("complete") : { items: [] }));
    const { result } = renderHook(() => useProfileWork({ includePrs: true }), { wrapper });
    await waitFor(() => expect(result.current.prs.data?.reviews).toHaveLength(1));
    configured = false;
    await act(async () => { await result.current.prs.mutate(); });
    expect(result.current.prs.error).toBeTruthy();
    expect(result.current.prs.data?.reviews).toHaveLength(1);
  });

  it("clears old-profile badges while the newly selected profile's counts load", async () => {
    let resolveHome!: (response: Response) => void;
    const counts = (profile: string, needsYou: number) => ({ profile, needsYou, tasks: 10, tickets: 0, prs: 80, actionablePrs: 2, shared: 0, signatures: { tickets: "", prs: "" } });
    fetchMock.mockImplementation((key: string) => {
      if (key === "/api/tasks/profiles") return Promise.resolve(Response.json({ active: "work" }));
      if (key === "/api/sidebar/counts?taskProfile=home") return new Promise<Response>((resolve) => { resolveHome = resolve; });
      if (key.startsWith("/api/sidebar/counts")) return Promise.resolve(Response.json(counts("work", 4)));
      return Promise.resolve(Response.json(key.startsWith("/api/storyboard") ? board("complete") : { items: [] }));
    });
    const { result } = renderHook(() => ({ work: useProfileWork(), counts: useSidebarCounts() }), { wrapper });
    await waitFor(() => expect(result.current.counts?.needsYou).toBe(4));
    await act(async () => { await result.current.work.profile.mutate({ mode: "profiles", active: "home", profiles: ["home", "work"], legacyFiles: 0, overlay: [] }, { revalidate: false }); });
    expect(result.current.counts).toBeUndefined();
    await waitFor(() => expect(resolveHome).toBeTypeOf("function"));
    await act(async () => { resolveHome(Response.json(counts("home", 7))); });
    await waitFor(() => expect(result.current.counts).toMatchObject({ profile: "home", needsYou: 7 }));
  });
});
