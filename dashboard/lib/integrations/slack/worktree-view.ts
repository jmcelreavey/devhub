import os from "node:os";
import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import { escapeSlackText, slackContext, slackDashboardUrl, slackLine, slackLink, slackOpenButton, slackTextMessage } from "./format";

export const WORKTREE_LIMIT = 8;
const PREVIEW_LIMIT = 15;
/** repos_worktree_cleanup takes at most this many items per call. */
export const WORKTREE_MAX_ITEMS = 200;

export interface WorktreeItem { repo: string; path: string }
export interface WorktreeRow extends WorktreeItem {
  branch: string | null;
  /** Why DevHub thinks it's finished: a merged PR, a stopped agent run, or a folder that's already gone. */
  reason: string;
  /** clean: would be removed. skipped: the dry run left it alone, with git's or DevHub's reason. */
  state: "clean" | "skipped";
  skipReason?: string;
}
export interface WorktreeView { rows: WorktreeRow[]; kept: number; failedRepos: string[] }
export interface WorktreePreview { removable: WorktreeItem[]; skipped: Array<WorktreeItem & { reason: string }> }

type Row = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function parseJson(text: string): Row | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : undefined;
  } catch { return undefined; }
}

function reasonLabel(row: Row): string {
  const pr = row.pr !== null && typeof row.pr === "object" ? row.pr as Row : undefined;
  if (row.reason === "pr-merged") return pr?.number ? `PR #${String(pr.number)} merged` : "PR merged";
  if (row.reason === "run-finished") return "agent run finished";
  if (row.reason === "folder-missing") return "folder already gone";
  return str(row.reason) || "finished";
}

/** Reads `repos_worktree_cleanup` list output. Undefined when the tool said something else. */
export function parseWorktreeList(text: string): { rows: Array<WorktreeItem & { branch: string | null; reason: string }>; kept: number; failedRepos: string[] } | undefined {
  const data = parseJson(text);
  if (!data || !Array.isArray(data.rows)) return undefined;
  const rows = (data.rows as Row[]).flatMap((row) => str(row.repo) && str(row.path)
    ? [{ repo: str(row.repo), path: str(row.path), branch: typeof row.branch === "string" ? row.branch : null, reason: reasonLabel(row) }] : []);
  return { rows, kept: typeof data.kept === "number" ? data.kept : 0, failedRepos: Array.isArray(data.failedRepos) ? (data.failedRepos as unknown[]).filter((name): name is string => typeof name === "string") : [] };
}

/** Reads a dry-run (or a real) removal: what goes and what's left alone, with reasons. */
export function parseWorktreeRemoval(text: string): { removed: string[]; skipped: Array<WorktreeItem & { reason: string }> } | undefined {
  const data = parseJson(text);
  if (!data || !Array.isArray(data.removed) || !Array.isArray(data.skipped)) return undefined;
  return {
    removed: (data.removed as unknown[]).filter((path): path is string => typeof path === "string"),
    skipped: (data.skipped as Row[]).map((row) => ({ repo: str(row.repo), path: str(row.path), reason: str(row.reason) || "left alone" })),
  };
}

/** The list joined with a dry run over the same items: clean ones can go, the rest say why not. */
export function joinWorktrees(list: NonNullable<ReturnType<typeof parseWorktreeList>>, dryRun: NonNullable<ReturnType<typeof parseWorktreeRemoval>>): WorktreeView {
  const removable = new Set(dryRun.removed);
  const skipped = new Map(dryRun.skipped.map((item) => [item.path, item.reason]));
  const rows = list.rows.map((row): WorktreeRow => removable.has(row.path) ? { ...row, state: "clean" } : { ...row, state: "skipped", skipReason: skipped.get(row.path) ?? "left alone" });
  return { rows: [...rows.filter((row) => row.state === "clean"), ...rows.filter((row) => row.state === "skipped")], kept: list.kept, failedRepos: list.failedRepos };
}

function shortPath(path: string): string {
  const home = os.homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** git's "contains modified or untracked files" and DevHub's own reasons, in one word where there is one. */
function stateWord(row: WorktreeRow): string {
  if (row.state === "clean") return "clean";
  return /uncommitted|modified|untracked/i.test(row.skipReason ?? "") ? "dirty" : `skipped: ${row.skipReason}`;
}

function rowBlock(row: WorktreeRow): KnownBlock {
  const title = [row.repo, row.branch].filter(Boolean).join(" · ");
  const meta = `${shortPath(row.path)} · ${row.reason} · ${stateWord(row)}`;
  return { type: "section", text: { type: "mrkdwn", text: `${escapeSlackText(slackLine(title, 120))}\n${escapeSlackText(slackLine(meta, 240))}`, verbatim: true } };
}

/** `cleanId` is the view-entry id for the "Clean up N" button; omit when nothing can be removed. */
export function formatWorktreeList(input: { view: WorktreeView; channel: string; threadTs?: string; cleanId?: string }): SlackMessage {
  const { view } = input;
  const clean = view.rows.filter((row) => row.state === "clean").length;
  const title = `Worktrees · ${view.rows.length}`;
  const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: title } }];
  const fallback = [title];
  if (!view.rows.length) { blocks.push({ type: "section", text: { type: "plain_text", text: "No finished worktrees to clean up." } }); fallback.push("No finished worktrees to clean up."); }
  for (const row of view.rows.slice(0, WORKTREE_LIMIT)) { blocks.push(rowBlock(row)); fallback.push(`${row.repo} ${row.branch ?? ""} — ${row.reason}, ${stateWord(row)}`); }
  if (view.rows.length > WORKTREE_LIMIT) blocks.push(slackContext(`+${view.rows.length - WORKTREE_LIMIT} more in ${slackLink("DevHub", slackDashboardUrl("/prs?tab=cleanup"))}`));
  const notes = [view.kept ? `${view.kept} more in use or locked, left out` : "", view.failedRepos.length ? `couldn't read ${view.failedRepos.length} repo${view.failedRepos.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  if (notes.length) blocks.push(slackContext(escapeSlackText(notes.join(" · "))));
  if (input.cleanId && clean) blocks.push({ type: "actions", elements: [{ type: "button", action_id: "devhub_tool_view", value: input.cleanId, style: "primary", text: { type: "plain_text", text: `Clean up ${clean}` } }] });
  else blocks.push(slackOpenButton(slackDashboardUrl("/prs?tab=cleanup")));
  return slackTextMessage(input.channel, fallback.join("\n"), input.threadTs, blocks);
}

/**
 * What "Clean up N" would do, exactly, then the one red button. `confirmId` is the single-use run entry
 * for repos_worktree_cleanup remove; `cancelId` can be the same id (cancel claims it without running).
 */
export function formatWorktreePreview(input: { preview: WorktreePreview; rows: readonly WorktreeRow[]; channel: string; threadTs?: string; confirmId?: string }): SlackMessage {
  const { preview } = input;
  const byPath = new Map(input.rows.map((row) => [row.path, row]));
  const count = preview.removable.length;
  const title = count ? `Remove ${count} worktree${count === 1 ? "" : "s"}?` : "Nothing to remove";
  const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: title } }];
  const lines = preview.removable.slice(0, PREVIEW_LIMIT).map((item) => {
    const row = byPath.get(item.path);
    return `${escapeSlackText(slackLine([item.repo, row?.branch].filter(Boolean).join(" · "), 100))} — ${escapeSlackText(shortPath(item.path))}${row ? ` (${escapeSlackText(row.reason)})` : ""}`;
  });
  if (lines.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Will be removed*\n${lines.join("\n")}${count > lines.length ? `\n+${count - lines.length} more` : ""}`, verbatim: true } });
  if (preview.skipped.length) {
    const skipped = preview.skipped.slice(0, PREVIEW_LIMIT).map((item) => `${escapeSlackText(slackLine(item.repo, 60))} — ${escapeSlackText(shortPath(item.path))}: ${escapeSlackText(slackLine(item.reason, 100))}`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Skipped, left as they are*\n${skipped.join("\n")}${preview.skipped.length > skipped.length ? `\n+${preview.skipped.length - skipped.length} more` : ""}`, verbatim: true } });
  }
  if (!count) blocks.push({ type: "section", text: { type: "plain_text", text: "Everything on the list is dirty, in use or already gone. Nothing was changed." } });
  else {
    blocks.push(slackContext("Only the checkout folders are deleted; branches and commits stay. This can't be undone. Confirm within 10 minutes."));
    blocks.push({ type: "actions", elements: [
      { type: "button", action_id: "devhub_tool_confirm", value: input.confirmId, text: { type: "plain_text", text: `Yes, remove ${count}` }, style: "danger" },
      { type: "button", action_id: "devhub_tool_cancel", value: input.confirmId, text: { type: "plain_text", text: "Cancel" } },
    ] });
  }
  const text = [title, ...lines, ...(preview.skipped.length ? [`Skipped ${preview.skipped.length}`] : []), ...(count ? ["This can't be undone."] : [])].join("\n");
  return slackTextMessage(input.channel, text, input.threadTs, blocks);
}
