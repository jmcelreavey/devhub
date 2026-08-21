"use client";

import { useMemo, useState } from "react";
import { GripVertical, ListTree, RefreshCw } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { SortableList } from "@/components/ui/SortableList";
import type { RebaseOp, RebaseStep } from "@/lib/git/rebase-todo";
import type { GraphLaneCommit } from "@/lib/repos/git-graph";
import type { StashConflictPayload } from "@/app/repos/types";
import { postGitAction, repoApi } from "./shared";

const OPS: { value: RebaseOp; label: string; hint: string }[] = [
  { value: "pick", label: "keep", hint: "Apply as-is" },
  { value: "reword", label: "reword", hint: "Change the message" },
  { value: "squash", label: "squash", hint: "Fold into the commit above, combine messages" },
  { value: "fixup", label: "fixup", hint: "Fold into the commit above, discard this message" },
  { value: "drop", label: "drop", hint: "Remove entirely" },
];

/**
 * Drag-to-reorder editor for a scripted `git rebase -i`.
 *
 * Lists every commit newer than the chosen base (the range rebase will
 * rewrite). The server executes the plan with a generated todo file — no
 * editors, no TTY — so whatever is shown here is exactly what runs.
 */
export function RebasePlanModal({
  open,
  onClose,
  repoName,
  base,
  commits,
  onConflict,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  repoName: string;
  /** Rebase rewrites everything after this commit. */
  base: GraphLaneCommit | null;
  /** Loaded history, newest first. */
  commits: GraphLaneCommit[];
  onConflict: (c: StashConflictPayload) => Promise<void>;
  onDone: () => void | Promise<void>;
}) {
  const [steps, setSteps] = useState<RebaseStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = useMemo<{ steps: RebaseStep[] } | null>(() => {
    if (!base) return null;
    const idx = commits.findIndex((c) => c.hash === base.hash || c.shortHash === base.shortHash);
    if (idx < 0) return null;
    const rows = commits.slice(0, idx);
    return {
      steps:
        steps && sameCommits(steps, rows)
          ? steps
          : rows.map((c) => ({ commit: c.hash, op: "pick" as const })),
    };
  }, [base, commits, steps]);

  if (!base || !derived) return null;

  const plan = derived.steps;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await postGitAction<{ ok?: boolean }>(repoApi(repoName, "/git/rebase-interactive"), {
        base: base!.hash,
        steps: plan,
      });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          onClose();
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      onClose();
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebase failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Rewrite history after ${base.shortHash}`}
      description={`${plan.length} commit${plan.length === 1 ? "" : "s"} will be rewritten onto ${base.shortHash}. Working tree must be clean; conflicts open in the Conflicts tab.`}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? <RefreshCw size={11} className="animate-spin" /> : <ListTree size={11} />}
            {busy ? "Rebasing…" : `Rebase ${plan.length} commit${plan.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="repo-git-rebase-list">
        {error && <div className="repo-git-rebase-error">{error}</div>}
        <SortableList
          items={plan}
          getId={(s) => s.commit}
          onReorder={(next) => setSteps(next)}
          renderItem={(step, state) => {
            const commitRow = commits.find(
              (c) => c.hash === step.commit || c.shortHash === step.commit,
            );
            const opMeta = OPS.find((o) => o.value === step.op)!;
            return (
              <div className="repo-git-rebase-row" data-dragging={state.isDragging || undefined}>
                <button
                  type="button"
                  className="repo-git-rebase-grip"
                  aria-label={`Reorder ${commitRow?.shortHash ?? step.commit.slice(0, 7)}`}
                  title="Drag to reorder"
                  {...state.dragHandleProps}
                >
                  <GripVertical size={12} aria-hidden />
                </button>
                <span className="repo-git-graph-hash font-mono">
                  {commitRow?.shortHash ?? step.commit.slice(0, 7)}
                </span>
                <span className="repo-git-rebase-subject truncate" title={commitRow?.subject}>
                  {commitRow?.subject ?? "(not in loaded history)"}
                </span>
                <select
                  className="input repo-git-rebase-op"
                  value={step.op}
                  aria-label={`Operation for ${commitRow?.shortHash ?? step.commit}`}
                  title={opMeta.hint}
                  onChange={(e) => {
                    const op = e.target.value as RebaseOp;
                    setSteps(
                      plan.map((s) =>
                        s.commit === step.commit
                          ? {
                              ...s,
                              op,
                              message:
                                op === "reword" && !s.message ? (commitRow?.subject ?? "") : s.message,
                            }
                          : s,
                      ),
                    );
                  }}
                >
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }}
        />
        {plan.some((s) => s.op === "reword") && (
          <div className="repo-git-rebase-messages">
            {plan
              .filter((s) => s.op === "reword")
              .map((s) => (
                <label key={s.commit} className="repo-git-rebase-message">
                  <span className="repo-git-section-label">
                    New message for {commits.find((c) => c.hash === s.commit)?.shortHash ?? s.commit.slice(0, 7)}
                  </span>
                  <textarea
                    className="input repo-git-commit-input"
                    rows={2}
                    value={s.message ?? ""}
                    onChange={(e) =>
                      setSteps(
                        plan.map((x) =>
                          x.commit === s.commit ? { ...x, message: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function sameCommits(steps: RebaseStep[], rows: GraphLaneCommit[]): boolean {
  return (
    steps.length === rows.length &&
    steps.every((s, i) => s.commit === rows[i]!.hash || s.commit === rows[i]!.shortHash)
  );
}
