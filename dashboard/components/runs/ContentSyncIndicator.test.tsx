/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentSyncIndicator } from "./ContentSyncIndicator";

const mocks = vi.hoisted(() => ({
  git: { dirtyCount: 0, otherDirtyCount: 0, notesCount: 0, tasksCount: 0, diagramsCount: 0, docsCount: 0, ahead: 0, behind: 0 } as Record<string, unknown>,
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  wait: vi.fn(),
}));

vi.mock("swr", () => ({ default: (key: string) => ({ data: key === "/api/status/git" ? mocks.git : false, mutate: mocks.mutate }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("@/lib/wait-for-script-run", () => ({ waitForScriptRun: mocks.wait }));
vi.mock("@/lib/scripts-history-swr", () => ({ revalidateScriptsHistory: vi.fn() }));
vi.mock("@/components/ui/HoverTip", () => ({ HoverTip: ({ children, label }: { children: ReactNode; label: string }) => <span title={label}>{children}</span> }));
vi.mock("@/components/repo-git/RepoGitWorkspace", () => ({ RepoGitWorkspace: () => null }));
vi.mock("@/components/repo-git/GitHookFailureDialog", () => ({
  GitHookFailureDialog: ({ failure }: { failure: { hook?: string } | null }) => failure ? <div role="dialog">{failure.hook} dialog</div> : null,
}));

describe("ContentSyncIndicator count copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.git = { dirtyCount: 0, otherDirtyCount: 0, notesCount: 0, tasksCount: 0, diagramsCount: 0, docsCount: 0, ahead: 0, behind: 0 };
    mocks.wait.mockResolvedValue(2);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url === "/api/status/git" ? { ...mocks.git, dirtyCount: 0, notesCount: 0 } : { runId: "run", lines: [] },
    })));
  });

  it.each([1, 3])("pluralises the sync action and tooltip for %i changes", (count) => {
    mocks.git.notesCount = count;
    mocks.git.dirtyCount = count;
    render(<ContentSyncIndicator />);
    const noun = count === 1 ? "change" : "changes";
    expect(screen.getByRole("button", { name: `Sync ${count} content ${noun}` })).toBeEnabled();
    expect(screen.getByTitle(`${count} content ${noun}. Click to sync.`)).toBeTruthy();
  });

  it.each([1, 3])("pluralises the push action for %i commits", (count) => {
    mocks.git.ahead = count;
    render(<ContentSyncIndicator />);
    expect(screen.getByRole("button", { name: `Push ${count} unpushed commit${count === 1 ? "" : "s"}` })).toBeEnabled();
  });

  it.each(["sync", "push"] as const)("uses remains for one unpushed commit in the %s failure toast", async (action) => {
    mocks.git.ahead = 1;
    if (action === "sync") {
      mocks.git.notesCount = 1;
      mocks.git.dirtyCount = 1;
    }
    render(<ContentSyncIndicator />);
    fireEvent.click(screen.getByRole("button", { name: action === "sync" ? "Sync 1 content change" : "Push 1 unpushed commit" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("1 unpushed commit remains.")));
  });

  it.each(([["sync"], ["push"]] as const))("toasts the unpushed commit instead of opening the hook dialog when the remote's pre-receive hook rejects the %s", async (action) => {
    // The hook dialog only mounts when the repo is known, so give it one or "no dialog" proves nothing.
    Object.assign(mocks.git, { ahead: 1, repoName: "devhub-private", repoPath: "/repo" });
    if (action === "sync") {
      mocks.git.notesCount = 1;
      mocks.git.dirtyCount = 1;
    }
    mocks.wait.mockImplementation(async (_runId: string, { onLine }: { onLine: (line: string) => void }) => {
      for (const line of [
        "[pre-push] Leak scan passed",
        "[pre-push] every pushed commit is content-only - skipping verify",
        " ! [remote rejected] main -> main (pre-receive hook declined)",
        "error: failed to push some refs to 'github.com:example/devhub-private.git'",
      ]) onLine(line);
      return 1;
    });
    vi.mocked(fetch).mockImplementation((async (url: string) => ({
      ok: true,
      json: async () => url === "/api/status/git" ? { ...mocks.git, dirtyCount: 0, notesCount: 0 } : { runId: "run", lines: [] },
    })) as typeof fetch);
    render(<ContentSyncIndicator />);
    fireEvent.click(screen.getByRole("button", { name: action === "sync" ? "Sync 1 content change" : "Push 1 unpushed commit" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/rejected by the remote's pre-receive hook.*1 unpushed commit remains\./)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens the hook dialog for a failing local pre-push", async () => {
    Object.assign(mocks.git, { ahead: 1, repoName: "devhub-private", repoPath: "/repo" });
    mocks.wait.mockImplementation(async (_runId: string, { onLine }: { onLine: (line: string) => void }) => {
      for (const line of ["[pre-push] Verify failed. Fix the errors above.", "error: failed to push some refs to 'origin'"]) onLine(line);
      return 1;
    });
    render(<ContentSyncIndicator />);
    fireEvent.click(screen.getByRole("button", { name: "Push 1 unpushed commit" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("pre-push dialog");
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
