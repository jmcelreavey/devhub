/*
 * Empty baseline — overwritten locally by a plugin overlay (see
 * `dashboard.overlays` in the plugin manifest and lib/plugins/materialize.ts).
 * The local copy is kept out of git churn via `git update-index
 * --skip-worktree`, same convention as plugin-nav.generated.ts. The committed
 * version renders nothing so the core builds without plugins.
 */

export function RepoRadarSection(_props: { repoName: string; autoOpenSignal?: string }) {
  return null;
}
