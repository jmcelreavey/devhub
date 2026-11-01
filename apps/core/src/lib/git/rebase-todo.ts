/**
 * Build the todo file for a scripted `git rebase -i`.
 *
 * The plan comes from the UI as an ordered list of steps. Reword/squash/fixup
 * messages are applied with `exec git commit --amend` lines rather than the
 * `reword`/`squash` todo verbs, so no editor ever opens: GIT_EDITOR would need
 * to know *which* commit it is editing, and COMMIT_EDITMSG does not reliably
 * say. An exec-amend after each pick is deterministic and testable.
 */

export type RebaseOp = "pick" | "reword" | "fixup" | "squash" | "drop";

export interface RebaseStep {
  /** Abbreviated or full sha of the commit this step applies to. */
  commit: string;
  op: RebaseOp;
  /** Replacement message; required for reword, optional for squash/fixup. */
  message?: string;
}

export type RebaseTodo =
  | { ok: true; todo: string }
  | { ok: false; error: string };

const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Map one step to its todo line(s). Exported for tests. */
export function stepToLines(
  step: RebaseStep,
  index: number,
  messagePath: (sha: string) => string,
): string[] {
  const sha = step.commit.trim();
  if (step.op === "drop") return [`drop ${sha}`];
  if (step.op === "reword") {
    // The `reword` verb opens an editor per commit; pick + exec-amend never does.
    const lines = [`pick ${sha}`];
    if (step.message !== undefined) {
      lines.push(`exec git commit --amend --no-verify -F ${shellQuote(messagePath(sha))}`);
    }
    return lines;
  }
  if (step.op === "pick") return [`pick ${sha}`];
  // fixup/squash fold natively with no editor; squash's combined-message editor
  // is neutralised by GIT_EDITOR=true, then an optional exec-amend sets the
  // exact message the plan asked for.
  const lines = [`${step.op} ${sha}`];
  if (step.message && step.message.trim()) {
    lines.push(`exec git commit --amend --no-verify -F ${shellQuote(messagePath(sha))}`);
  }
  return lines;
}

function shellQuote(path: string): string {
  // Paths we generate live under os.tmpdir(); quote anyway so spaces survive.
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function buildRebaseTodo(
  steps: RebaseStep[],
  messagePath: (sha: string) => string,
): RebaseTodo {
  if (steps.length === 0) return { ok: false, error: "No commits in the rebase plan." };

  const seen = new Set<string>();
  let pickedSoFar = 0;
  const lines: string[] = [];

  for (const step of steps) {
    const sha = step.commit.trim();
    if (!SHA_RE.test(sha)) return { ok: false, error: `Invalid commit ref: ${sha}` };
    if (seen.has(sha)) return { ok: false, error: `Commit ${sha} appears twice in the plan.` };
    seen.add(sha);

    if (step.op === "reword" && !step.message?.trim()) {
      return { ok: false, error: `Reword of ${sha} needs a message.` };
    }
    if ((step.op === "squash" || step.op === "fixup") && pickedSoFar === 0) {
      return {
        ok: false,
        error: `${step.op} cannot be the first step — there is nothing earlier in the range to fold into.`,
      };
    }

    lines.push(...stepToLines(step, pickedSoFar, messagePath));
    if (step.op !== "drop") pickedSoFar += 1;
  }

  if (pickedSoFar === 0) {
    return { ok: false, error: "Every commit is dropped — reset instead of rebasing." };
  }
  return { ok: true, todo: `${lines.join("\n")}\n` };
}
