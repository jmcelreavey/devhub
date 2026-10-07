import { shellQuote } from "@/lib/shell-quote";

export const UPSTART_WORKTREE_INSTRUCTIONS =
  "Make the script worktree agnostic: resolve the current checkout root with git rev-parse --show-toplevel and cd there before any project operation. Never hardcode a checkout or use the script location as the project root. If .env is absent in a linked worktree, copy it from the main checkout identified by git worktree list --porcelain before falling back to .env.example; never overwrite an existing .env.";

/** Resolve the selected checkout's root, even when a reused terminal changed cwd. */
export function repoUpstartCommand(upstartPath: string, repoPath: string): string {
  return `cd -- ${shellQuote(repoPath)} && upstart_root=$(git rev-parse --show-toplevel) && cd -- "$upstart_root" && bash ${shellQuote(upstartPath)}`;
}
