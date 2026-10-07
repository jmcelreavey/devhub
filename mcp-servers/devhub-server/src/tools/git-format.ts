/**
 * Text renderers for the repos_git_* tools. The Git workspace API returns what
 * the UI needs — graph lanes, a parsed `lines[]` copy of every diff next to the
 * raw text, the file list four times over — and passing that through as JSON
 * cost 3-11x the tokens of the equivalent git output (a full-repo diff came
 * back at ~950k chars). These keep the facts an agent acts on and drop the rest.
 */

/** Diffs and blames beyond this are cut, with a note on how to narrow the call. */
export const GIT_TEXT_LIMIT = 60_000;

export function capText(text: string, hint: string, limit = GIT_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  // Cut on a line boundary so the tail is not half a diff line.
  const cut = text.lastIndexOf("\n", limit);
  const kept = text.slice(0, cut > 0 ? cut : limit);
  return `${kept}\n\n[truncated: showing ${kept.length} of ${text.length} chars — ${hint}]`;
}

interface StatusFile {
  path: string;
  indexStatus?: string;
  worktreeStatus?: string;
  untracked?: boolean;
  staged?: boolean;
  unstaged?: boolean;
}

export interface GitStatusPayload {
  currentBranch?: string;
  upstream?: string | null;
  files?: StatusFile[];
  conflictCount?: number;
  clean?: boolean;
}

const STATUS_FILE_LIMIT = 300;

/** Porcelain-style `XY path` lines under a one-line summary. */
export function formatGitStatus(data: GitStatusPayload): string {
  const files = data.files ?? [];
  const branch = `${data.currentBranch ?? "HEAD"}${data.upstream ? ` → ${data.upstream}` : " (no upstream)"}`;
  if (data.clean || files.length === 0) return `On ${branch}: clean working tree.`;

  const staged = files.filter((f) => f.staged).length;
  const unstaged = files.filter((f) => f.unstaged).length;
  const untracked = files.filter((f) => f.untracked).length;
  const conflicts = data.conflictCount ? `, ${data.conflictCount} conflicted` : "";
  const header =
    `On ${branch}: ${files.length} changed (${staged} staged, ${unstaged} unstaged, ${untracked} untracked${conflicts}).\n` +
    "Columns: index, worktree (? = untracked).";
  const lines = files.slice(0, STATUS_FILE_LIMIT).map((f) => {
    const code = f.untracked ? "??" : `${f.indexStatus || " "}${f.worktreeStatus || " "}`;
    return `${code} ${f.path}`;
  });
  const more = files.length > lines.length ? `\n… +${files.length - lines.length} more` : "";
  return `${header}\n${lines.join("\n")}${more}`;
}

export interface GitDiffPayload {
  kind?: "file" | "directory";
  raw?: string;
  empty?: boolean;
  message?: string;
  entries?: { name: string; type: string }[];
}

export function formatGitDiff(data: GitDiffPayload, target: string): string {
  if (data.kind === "directory") {
    const entries = (data.entries ?? []).map((e) => `- ${e.name}${e.type === "dir" ? "/" : ""}`).join("\n");
    return `${data.message ?? "Untracked directory."}${entries ? `\n${entries}` : ""}`;
  }
  const raw = data.raw ?? "";
  if (data.empty || !raw.trim()) return `No changes in ${target}.`;
  return capText(raw, "pass path for one file; repos_git_status lists the changed files");
}

interface LogCommit {
  shortHash?: string;
  hash?: string;
  subject?: string;
  author?: string;
  relativeDate?: string;
  refs?: string[];
  isMerge?: boolean;
}

export interface GitLogPayload {
  commits?: LogCommit[];
  hasMore?: boolean;
  nextOffset?: number;
}

export function formatGitLog(data: GitLogPayload): string {
  const commits = data.commits ?? [];
  if (commits.length === 0) return "No commits.";
  const lines = commits.map((c) => {
    const refs = c.refs?.length ? ` (${c.refs.join(", ")})` : "";
    const merge = c.isMerge ? " [merge]" : "";
    return `${c.shortHash ?? c.hash?.slice(0, 9) ?? "?"} ${c.relativeDate ?? ""} · ${c.author ?? "?"} · ${c.subject ?? ""}${refs}${merge}`;
  });
  const more = data.hasMore ? `\n\nMore: pass offset=${data.nextOffset ?? commits.length}.` : "";
  return `${lines.join("\n")}${more}`;
}

export interface GitShowPayload {
  hash?: string;
  subject?: string;
  body?: string;
  author?: string;
  authorEmail?: string;
  date?: string;
  parents?: string[];
  files?: { path: string; status: string }[];
  path?: string | null;
  raw?: string;
}

export function formatGitShow(data: GitShowPayload): string {
  const files = data.files ?? [];
  const head = [
    `commit ${data.hash ?? "?"}${(data.parents?.length ?? 0) > 1 ? " (merge)" : ""}`,
    `Author: ${data.author ?? "?"}${data.authorEmail ? ` <${data.authorEmail}>` : ""}`,
    `Date:   ${data.date ?? "?"}`,
    "",
    `    ${data.subject ?? ""}`,
    ...(data.body ? ["", ...data.body.split("\n").map((l) => `    ${l}`)] : []),
    "",
    `Files (${files.length}):`,
    ...files.map((f) => `${f.status} ${f.path}`),
  ].join("\n");
  const raw = data.raw ?? "";
  if (!data.path || !raw.trim()) return head;
  const others = files.length > 1 ? " (pass path for another file)" : "";
  return `${head}\n\nPatch for ${data.path}${others}:\n${capText(raw, "the file diff is large; use repos_git_blame or a narrower path")}`;
}

export interface GitBlamePayload {
  path?: string;
  lines?: { hash: string; author: string; date: string; lineNumber: number; content: string }[];
  history?: { shortHash: string; subject: string; author: string; relativeDate: string }[];
  historyScope?: string;
}

/** One line per source line, `hash author date  n| content`, then recent history. */
export function formatGitBlame(data: GitBlamePayload, range?: { startLine?: number; endLine?: number }): string {
  const start = range?.startLine ?? 1;
  const end = range?.endLine ?? Number.POSITIVE_INFINITY;
  const all = data.lines ?? [];
  const lines = all.filter((l) => l.lineNumber >= start && l.lineNumber <= end);
  const body = lines
    .map((l) => `${l.hash.slice(0, 8)} ${l.author.slice(0, 18).padEnd(18)} ${l.date.slice(0, 10)} ${String(l.lineNumber).padStart(5)}| ${l.content}`)
    .join("\n");
  const history = (data.history ?? [])
    .slice(0, 15)
    .map((h) => `- ${h.shortHash} ${h.relativeDate} · ${h.author} · ${h.subject}`)
    .join("\n");
  const scope = data.historyScope === "line" ? "line" : "file";
  const blame = body
    ? capText(body, "pass startLine/endLine to blame a range")
    : `No blame lines${all.length ? ` in ${start}-${range?.endLine ?? all.length}` : ""}.`;
  return `${blame}${history ? `\n\nRecent ${scope} history:\n${history}` : ""}`;
}

interface Branch {
  name: string;
  current?: boolean;
  upstream?: string | null;
  shortHash?: string;
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
  worktreePath?: string;
  staleDays?: number;
}

export interface GitBranchesPayload {
  branches?: Branch[];
  remoteBranches?: unknown[];
  currentBranch?: string;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  stashCount?: number;
  changedFiles?: unknown[];
  unpushedCommits?: unknown[];
  mainBranch?: string | null;
  aheadMain?: number;
  behindMain?: number;
  tags?: string[];
  lastFetchAt?: string | number | null;
}

export function formatGitBranches(data: GitBranchesPayload): string {
  const branches = data.branches ?? [];
  const summary = [
    `Current: ${data.currentBranch ?? "HEAD"}${data.upstream ? ` → ${data.upstream}` : " (no upstream)"}`,
    `ahead ${data.ahead ?? 0} / behind ${data.behind ?? 0}`,
    data.mainBranch ? `vs ${data.mainBranch}: +${data.aheadMain ?? 0} -${data.behindMain ?? 0}` : null,
    `${data.changedFiles?.length ?? 0} changed file(s)`,
    `${data.unpushedCommits?.length ?? 0} unpushed`,
    `${data.stashCount ?? 0} stash(es)`,
    data.lastFetchAt ? `last fetch ${data.lastFetchAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = branches.map((b) => {
    const flags = [
      b.upstream ? `→ ${b.upstream}` : "local only",
      b.ahead ? `↑${b.ahead}` : null,
      b.behind ? `↓${b.behind}` : null,
      b.upstreamGone ? "upstream gone" : null,
      b.staleDays ? `${b.staleDays}d stale` : null,
      b.worktreePath ? `worktree ${b.worktreePath}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `${b.current ? "*" : " "} ${b.name} ${b.shortHash ?? ""} [${flags}]`;
  });
  const tags = data.tags?.length ? `\nRecent tags: ${data.tags.slice(0, 10).join(", ")}` : "";
  return `${summary}\n\nLocal branches (${branches.length}):\n${lines.join("\n")}\n\nRemote branches: ${data.remoteBranches?.length ?? 0}${tags}`;
}
