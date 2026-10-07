// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorktreeInfo } from "@/lib/repos/worktree-info";
import { WorktreesPanel } from "./WorktreesPanel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), fetch: vi.fn(), confirm: vi.fn(), prompt: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./shared", () => ({ fetchGitJson: mocks.get, repoApi: (name: string, suffix: string) => `/api/repos/${name}${suffix}` }));
vi.mock("./WorktreeSchedule", () => ({ WorktreeSchedule: () => null }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/shell/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm, usePrompt: () => mocks.prompt }));
const base: WorktreeInfo = {
  path: "/repo/open", head: "a".repeat(40), branch: "feature", isMain: false,
  detached: false, locked: false, lockReason: "", prunable: false,
  title: "Send feedback", tasks: [], notes: [], runs: [],
  merge: { verified: false, reason: "PR #171 is still open", openPr: { number: 171, url: "https://github.com/test/repo/pull/171" } },
  details: { dirtyCount: 0, unpushedCount: 0, sizeBytes: 1024, ignoredPaths: [], lastActivity: null, blockers: [], candidate: true, reason: "Associated tasks finished" },
};
const main: WorktreeInfo = { ...base, path: "/repo", title: "Main checkout", isMain: true, merge: undefined };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.get.mockResolvedValue({ worktrees: [main, base], repoRoot: "/repo" });
  mocks.confirm.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ removed: ["/repo/merged"], errors: [] }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("worktree cleanup UX", () => {
  it("shows the remaining work before the main checkout and never offers an open PR for removal", async () => {
    render(<WorktreesPanel repoName="demo" onMutate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Send feedback" })).toBeVisible();
    expect(screen.getByRole("link", { name: "PR #171 open" })).toHaveAttribute("href", base.merge!.openPr!.url);
    expect(screen.getByText("Nothing ready to remove")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove|Select ready|cleanup review/i })).not.toBeInTheDocument();
    expect(screen.getByText("Main checkout").closest("details")).not.toHaveAttribute("open");
  });

  it("selects only safe merged checkouts and requires local-file acknowledgement before removal", async () => {
    const ready: WorktreeInfo = { ...base, path: "/repo/merged", title: "Merged fix", merge: { verified: true, reason: "Merged" },
      details: { ...base.details!, ignoredPaths: [".env"] } };
    mocks.get.mockResolvedValue({ worktrees: [main, base, ready, { ...ready, path: "/repo/locked", title: "Locked fix", locked: true }], repoRoot: "/repo" });
    const user = userEvent.setup();
    render(<WorktreesPanel repoName="demo" onMutate={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Select ready (1)" }));
    const remove = screen.getByRole("button", { name: "Remove 1 checkout" });
    expect(remove).toBeDisabled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("I reviewed these local files and agree to delete them"));
    await user.click(remove);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      entries: [{ path: ready.path, head: ready.head }], confirmed: true, includeIgnored: true, mergedOnly: true,
    });
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("lets a failed inventory retry without presenting it as an empty successful review", async () => {
    mocks.get.mockRejectedValueOnce(new Error("Review unavailable"));
    const user = userEvent.setup();
    render(<WorktreesPanel repoName="demo" onMutate={vi.fn()} />);
    expect(await screen.findByText("Review unavailable")).toBeVisible();
    expect(screen.queryByText("Nothing ready to remove")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("link", { name: "PR #171 open" })).toBeVisible();
  });
});
