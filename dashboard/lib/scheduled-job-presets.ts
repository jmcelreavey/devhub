export const WORKTREE_CLEANUP_JOB = {
  name: "Weekly idle worktree cleanup",
  script: "worktree_cleanup",
  cron: "17 3 * * 0",
  enabled: true,
  wake: false,
} as const;
