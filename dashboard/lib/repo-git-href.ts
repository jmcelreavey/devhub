import type { RepoGitTabId } from "@/components/repo-git/shared";

export interface RepoGitOpenOptions {
  tab?: RepoGitTabId;
  unpushed?: boolean;
  path?: string;
}

/** Shared by the repo list, hub, radar and content-sync entry points. */
export function repoGitHref(name: string, options: RepoGitOpenOptions = {}): string {
  const query = new URLSearchParams();
  const tab = options.path ? "changes" : options.unpushed ? "history" : options.tab;
  if (tab) query.set("tab", tab);
  if (options.unpushed) query.set("unpushed", "1");
  if (options.path) query.set("path", options.path);
  const search = query.toString();
  return `/repos/${encodeURIComponent(name)}/git${search ? `?${search}` : ""}`;
}
