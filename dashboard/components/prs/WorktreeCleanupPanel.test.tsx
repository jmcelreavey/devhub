// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCleanupRow } from "@/lib/repos/worktree-cleanup";

const mocks = vi.hoisted(() => ({ live: vi.fn(), mutate: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.live }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error, info: mocks.info }) }));
vi.mock("@/components/shell/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));

import { WorktreeCleanupPanel } from "./WorktreeCleanupPanel";

const row = (n: number, extra: Partial<WorktreeCleanupRow> = {}): WorktreeCleanupRow => ({
  repo: "app", repoPath: "/r/app", path: `/r/.wt/app-${n}`, branch: `b${n}`, reason: "pr-merged", pr: { number: n, title: "", url: `https://x/${n}`, mergedAt: "" }, ...extra,
});
const rows = [row(1, { reason: "run-finished", pr: undefined, run: { id: "run-42", state: "completed" } }), row(2), row(3), row(4)];
const body = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.live.mockReturnValue({ data: { rows, kept: 0, failedRepos: [] }, mutate: mocks.mutate, isLoading: false });
  mocks.confirm.mockResolvedValue(true);
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { dryRun } = JSON.parse(String(init.body));
    return Response.json({ ok: true, removed: ["/r/.wt/app-2", "/r/.wt/app-4"], skipped: [{ repo: "app", path: "/r/.wt/app-3", reason: "it has uncommitted changes" }], dryRun });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("WorktreeCleanupPanel", () => {
  it("links a run pill to its agent run, and makes the PR pill the PR link", () => {
    render(<WorktreeCleanupPanel />);
    const pill = screen.getByRole("link", { name: "agent run completed" });
    expect(pill.getAttribute("href")).toBe("/agents?run=run-42");
    const pr = screen.getByRole("link", { name: "#2 merged" });
    expect(pr.getAttribute("href")).toBe("https://x/2");
    expect(pr.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "PR" })).toBeNull();
  });

  it("gives each row a labelled icon delete button with the old confirm", async () => {
    render(<WorktreeCleanupPanel />);
    const button = screen.getByRole("button", { name: "Remove worktree /r/.wt/app-2" });
    expect(button.getAttribute("title")).toBe("Remove worktree");
    expect(button.className).not.toContain("btn");
    fireEvent.click(button);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove the worktree at /r/.wt/app-2?", variant: "danger" })));
    await waitFor(() => expect(body(fetchMock.mock.calls[0])).toEqual({ repo: "app", path: "/r/.wt/app-2" }));
  });

  it("selects a range with shift-click and shows a slim action bar", () => {
    render(<WorktreeCleanupPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select worktree /r/.wt/app-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select worktree /r/.wt/app-3" }), { shiftKey: true });
    const bar = screen.getByRole("toolbar", { name: "Selected worktrees" });
    expect(bar.textContent).toBe("3 selectedDelete·Clear");
    expect(screen.getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual([true, true, true, false]);
    fireEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete all" })).toBeTruthy();
  });

  it("Delete all previews first, confirms with the count and the skipped reasons, then deletes without force", async () => {
    render(<WorktreeCleanupPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Deleted 2 worktrees"));
    expect(body(fetchMock.mock.calls[0])).toEqual({ items: rows.map((r) => ({ repo: r.repo, path: r.path })), dryRun: true });
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "Delete 2 worktrees?",
      message: expect.stringContaining("1 worktree will be skipped (app-3: it has uncommitted changes)"),
      confirmLabel: "Delete 2",
    }));
    expect(body(fetchMock.mock.calls[1])).toEqual({ items: rows.map((r) => ({ repo: r.repo, path: r.path })) });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("force");
    expect(mocks.info).toHaveBeenCalledWith("Skipped 1: app-3: it has uncommitted changes.");
    expect(mocks.mutate).toHaveBeenCalled();
  });

  it("deletes nothing when the confirm is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<WorktreeCleanupPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select worktree /r/.wt/app-2" }));
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body(fetchMock.mock.calls[0]).dryRun).toBe(true);
  });
});
