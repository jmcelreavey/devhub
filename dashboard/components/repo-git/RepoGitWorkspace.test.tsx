import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GitHookFailurePayload } from "@/lib/git/hook-failure";
import type { DiffLine } from "@/lib/repos/git-parsers";
import { GitDiffView } from "./GitDiffView";
import { GitHookFailureDialog } from "./GitHookFailureDialog";
import { RepoGitWorkspace } from "./RepoGitWorkspace";

describe("repo Git workspace UI", () => {
  it("keeps browser-only modal state out of server rendering", () => {
    const html = renderToStaticMarkup(
      <RepoGitWorkspace
        repoName="devhub"
        repoPath="/tmp/devhub"
        dirtyCount={1}
        unpushedCount={0}
        onMutate={vi.fn()}
        open
        hideTrigger
      />,
    );

    expect(html).toBe('<div class="repo-git-workspace"></div>');
  });

  it("offers whole-hunk staging and marks the individually stageable lines", () => {
    const lines: DiffLine[] = [
      { type: "hunk", text: "@@ -1 +1 @@" },
      { type: "del", text: "-old" },
      { type: "add", text: "+new" },
      { type: "hunk", text: "@@ -8 +8 @@" },
      { type: "add", text: "+another" },
    ];
    const html = renderToStaticMarkup(
      <GitDiffView lines={lines} hunkMode="stage" onHunkAction={vi.fn()} />,
    );

    expect((html.match(/aria-label="Stage hunk"/g) ?? []).length).toBe(2);
    // Only the three changed lines are selectable — a context line cannot be
    // staged on its own, so making it look interactive would be a lie.
    expect((html.match(/repo-git-diff-selectable/g) ?? []).length).toBe(3);
  });

  it("does not offer line selection when staging is unavailable", () => {
    // A read-only diff (commit detail, range compare) has no staging target.
    const html = renderToStaticMarkup(
      <GitDiffView
        lines={[
          { type: "hunk", text: "@@ -1 +1 @@" },
          { type: "add", text: "+new" },
        ]}
      />,
    );
    expect(html).not.toContain("repo-git-diff-selectable");
  });

  it("uses the native dialog element for hook failures", () => {
    const failure: GitHookFailurePayload = {
      code: "hook_failed",
      phase: "push",
      hook: "pre-push",
      output: "Tests failed",
    };
    const html = renderToStaticMarkup(
      <GitHookFailureDialog
        failure={failure}
        repoName="devhub"
        repoPath="/tmp/devhub"
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('<dialog class="repo-git-hook-backdrop"');
    expect(html).toContain('aria-labelledby=');
    expect(html).not.toContain('role="dialog"');
  });
});
