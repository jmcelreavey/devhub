/*
 * Empty baseline — overwritten locally by a plugin overlay (see
 * `dashboard.overlays` in the plugin manifest and lib/plugins/materialize.ts).
 * The local copy is kept out of git churn via `git update-index
 * --skip-worktree`, same convention as plugin-nav.generated.ts. The committed
 * version renders nothing so the core builds without plugins.
 */

export function RepoRadarSection(props: { repoName: string; autoOpenSignal?: string }) {
  void props; // baseline renders nothing; the plugin overlay uses the props
  return null;
}
