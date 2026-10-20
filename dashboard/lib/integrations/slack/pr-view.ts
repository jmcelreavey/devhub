import type { KnownBlock } from "@slack/web-api";
import type { SlackMessage } from "./client";
import { escapeSlackText, slackContext, slackDashboardUrl, slackLine, slackLink, slackOpenButton, slackTextMessage } from "./format";
import { prIdentity, requestedPeerReviews } from "@/lib/github/actionable-prs";
import type { GithubPrRow } from "@/lib/github/prs";

export type PrSectionId = "mine" | "review" | "owned";
export const PR_SECTION_LIMIT = 5;
/** Rows one "Show more" click posts, so the thread reply stays inside one Slack message. */
export const PR_MORE_LIMIT = 15;

const TITLES: Record<PrSectionId, string> = { mine: "Mine", review: "Review requested", owned: "Owned repos" };
const EMPTY: Record<PrSectionId, string> = { mine: "No open PRs of yours.", review: "Nothing waiting for your review.", owned: "No other open PRs in your Owned repos." };
const HREFS: Record<PrSectionId, string> = { mine: "/prs?tab=authored", review: "/prs?tab=reviews", owned: "/prs?tab=owned" };
export const PR_SECTIONS: readonly PrSectionId[] = ["mine", "review", "owned"];

export interface SlackPrData {
  configured: boolean;
  authored: GithubPrRow[];
  reviews: GithubPrRow[];
  /** Open PRs in Owned repos. Undefined when they couldn't be read at all. */
  owned?: GithubPrRow[];
  /** Owned repos whose PRs couldn't be read, so the section is a lower bound. */
  ownedFailed: string[];
  ownedRepos?: string[];
  stale: boolean;
}

export interface PrRow { dot: string; title: string; url: string; repo: string; age?: string; author?: string; failing: boolean }
export type PrSections = Record<PrSectionId, PrRow[]>;

/** 🟢 passing · 🔴 failing · 🟡 running · ⚪ no CI result known. Never guesses green. */
export function ciDot(checks: GithubPrRow["checks"]): string {
  return checks === "passing" ? "🟢" : checks === "failing" ? "🔴" : checks === "pending" ? "🟡" : "⚪";
}

export function ageLabel(iso: string | undefined, now: number): string | undefined {
  const ms = iso ? now - Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function toRow(pr: GithubPrRow, section: PrSectionId, now: number): PrRow {
  return {
    dot: ciDot(pr.checks), title: pr.title, url: pr.url, repo: pr.repo, failing: pr.checks === "failing",
    age: ageLabel(pr.createdAt ?? pr.updatedAt, now),
    // My own PRs don't repeat me.
    author: section === "mine" ? undefined : pr.author?.login,
  };
}

/** Failing CI first, then the order the source gave (review requests are already sorted by DevHub). */
function failingFirst(rows: PrRow[]): PrRow[] {
  return [...rows.filter((row) => row.failing), ...rows.filter((row) => !row.failing)];
}

/**
 * Mine = my open PRs. Review requested = the same list Home and the PRs page use (peers only, closed and
 * merged dropped, my own removed). Owned repos = the Owned tab, minus anything already listed above.
 */
export function buildPrSections(data: SlackPrData, now = Date.now()): PrSections {
  const mine = [...new Map(data.authored.filter((pr) => pr.prState !== "closed" && pr.prState !== "merged").map((pr) => [prIdentity(pr), pr])).values()];
  const review = requestedPeerReviews(data.reviews, data.authored);
  const shown = new Set([...mine, ...review].map(prIdentity));
  const owned = (data.owned ?? []).filter((pr) => !shown.has(prIdentity(pr)));
  return {
    mine: failingFirst(mine.map((pr) => toRow(pr, "mine", now))),
    review: failingFirst(review.map((pr) => toRow(pr, "review", now))),
    owned: failingFirst(owned.map((pr) => toRow(pr, "owned", now))),
  };
}

export function rowBlock(row: PrRow): KnownBlock {
  const meta = [row.repo, row.age, row.author ? `by ${row.author}` : undefined].filter(Boolean).join(" · ");
  return { type: "section", text: { type: "mrkdwn", text: `${row.dot} ${slackLink(row.title, row.url)}\n${escapeSlackText(slackLine(meta, 200))}`, verbatim: true } };
}

function headingBlock(title: string, count: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: `*${escapeSlackText(title)} · ${count}*`, verbatim: true } };
}

function fallbackLine(row: PrRow): string {
  return `${row.dot} ${slackLine(row.title, 120)} — ${row.repo}${row.age ? ` ${row.age}` : ""}`;
}

/** `moreIds` holds the view-entry id for each section that has rows beyond the first five. */
export function formatPrCard(input: { sections: PrSections; data: SlackPrData; channel: string; threadTs?: string; moreIds: Partial<Record<PrSectionId, string>> }): SlackMessage {
  const { sections, data } = input;
  const total = PR_SECTIONS.reduce((sum, id) => sum + sections[id].length, 0);
  const blocks: KnownBlock[] = [{ type: "header", text: { type: "plain_text", text: `Pull requests · ${total}` } }];
  const fallback = [`Pull requests · ${total}`];
  for (const [index, id] of PR_SECTIONS.entries()) {
    const rows = sections[id];
    if (index) blocks.push({ type: "divider" });
    // An Owned section we couldn't read says so; a bare "0" would pass for good news.
    const unavailable = id === "owned" && (data.owned === undefined || data.ownedFailed.length > 0);
    const count = data.owned === undefined && id === "owned" ? "unavailable" : `${rows.length}${unavailable ? "+" : ""}`;
    blocks.push(headingBlock(TITLES[id], count));
    fallback.push(`${TITLES[id]} · ${count}`);
    for (const row of rows.slice(0, PR_SECTION_LIMIT)) { blocks.push(rowBlock(row)); fallback.push(fallbackLine(row)); }
    if (!rows.length && !(id === "owned" && data.owned === undefined)) blocks.push({ type: "section", text: { type: "plain_text", text: EMPTY[id] } });
    if (id === "owned" && data.owned === undefined) blocks.push(slackContext("Couldn't read your Owned repos just now."));
    else if (unavailable) blocks.push(slackContext(`Couldn't read ${data.ownedFailed.length} Owned repo${data.ownedFailed.length === 1 ? "" : "s"}, so this may be incomplete.`));
    if (rows.length > PR_SECTION_LIMIT) blocks.push(slackContext(`+${rows.length - PR_SECTION_LIMIT} more`));
  }
  if (data.stale) blocks.push(slackContext("GitHub was slow, so this is the last list DevHub had."));
  const buttons = PR_SECTIONS.flatMap((id) => input.moreIds[id] && sections[id].length > PR_SECTION_LIMIT
    ? [{ type: "button" as const, action_id: "devhub_tool_view", value: input.moreIds[id]!, text: { type: "plain_text" as const, text: `Show more ${TITLES[id].toLowerCase()}` } }] : []);
  for (const button of buttons) blocks.push({ type: "actions", elements: [button] });
  blocks.push(slackOpenButton(slackDashboardUrl("/prs")));
  return slackTextMessage(input.channel, fallback.join("\n"), input.threadTs, blocks);
}

/** The rest of one section, posted in the thread after "Show more". */
export function formatPrMore(input: { id: PrSectionId; rows: PrRow[]; channel: string; threadTs?: string }): SlackMessage {
  const rest = input.rows.slice(PR_SECTION_LIMIT);
  const shown = rest.slice(0, PR_MORE_LIMIT);
  const blocks: KnownBlock[] = [headingBlock(TITLES[input.id], `${PR_SECTION_LIMIT + 1}–${PR_SECTION_LIMIT + shown.length}`), ...shown.map(rowBlock)];
  if (rest.length > shown.length) blocks.push(slackContext(`+${rest.length - shown.length} more in ${slackLink("DevHub", slackDashboardUrl(HREFS[input.id]))}`));
  return slackTextMessage(input.channel, [`${TITLES[input.id]} (more)`, ...shown.map(fallbackLine)].join("\n"), input.threadTs, blocks);
}
