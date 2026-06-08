import type { JiraStandupTicket } from "./jira-client";
import type { StandupMergedPr } from "./standup-github-merged";
import { dedupeBy } from "./dedupe";
import { formatDuration } from "./utils";

export interface StandupTaskLine {
  text: string;
  jiraKey?: string;
  timeSpentMs?: number;
}

export interface StandupMarkdownInput {
  /** Local calendar YYYY-MM-DD for the standup header. */
  localToday: string;
  /** Commit subjects keyed by repo directory name. Plain object — JSON-friendly. */
  gitCommitsByRepo: Record<string, { subjects: string[]; truncated: boolean }>;
  jiraConfigured: boolean;
  jiraActivity: JiraStandupTicket[];
  jiraTruncated: boolean;
  mergedAuthored: StandupMergedPr[];
  mergedReviewedOthers: StandupMergedPr[];
  prsCreated: StandupMergedPr[];
  tasksCompleted: StandupTaskLine[];
}

/** Normalise Windows line endings so embedded strings don't corrupt the output. */
function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function prLine(p: StandupMergedPr, showMergedDate = false): string {
  const link = p.url ? `[${normalizeLf(p.title)}](${p.url})` : normalizeLf(p.title);
  const repoRef = p.url ? `[${p.repo}#${p.number}](${p.url})` : `${p.repo}#${p.number}`;
  const stateLabel =
    p.state === "merged"
      ? showMergedDate
        ? `merged ${fmtWhen(p.mergedAt)}`
        : "merged"
      : p.state === "closed"
        ? "closed"
        : "open";
  return `- ${link} — ${repoRef} — ${stateLabel}`;
}

function sortedMergedFirst(prs: StandupMergedPr[]): StandupMergedPr[] {
  return [...prs].sort((a, b) => {
    if (a.state === "merged" && b.state !== "merged") return -1;
    if (a.state !== "merged" && b.state === "merged") return 1;
    const aTime = a.state === "merged" ? a.mergedAt : a.createdAt;
    const bTime = b.state === "merged" ? b.mergedAt : b.createdAt;
    return bTime.localeCompare(aTime);
  });
}

export function buildStandupMarkdown(input: StandupMarkdownInput): string {
  const parts: string[] = [];

  parts.push(`# Standup — ${input.localToday}`);
  parts.push("");

  // Tasks first — most relevant for standup conversation
  parts.push("## Tasks completed today");
  parts.push("");
  if (input.tasksCompleted.length === 0) {
    parts.push("_None._");
  } else {
    for (const t of input.tasksCompleted) {
      const label = t.jiraKey ? `${t.jiraKey}: ${normalizeLf(t.text)}` : normalizeLf(t.text);
      const time = t.timeSpentMs && t.timeSpentMs > 0 ? ` _(${formatDuration(t.timeSpentMs)})_` : "";
      parts.push(`- ${label}${time}`);
    }
  }
  parts.push("");

  // Merge created + merged into one section, dedupe by URL, merged entries first
  const allAuthoredPrs = sortedMergedFirst(
    dedupeBy([...input.mergedAuthored, ...input.prsCreated], "url"),
  );

  parts.push("## PRs");
  parts.push("");
  if (allAuthoredPrs.length === 0) {
    parts.push("_None._");
  } else {
    parts.push(...allAuthoredPrs.map((p) => prLine(p, true)));
  }
  parts.push("");

  parts.push("## PRs reviewed");
  parts.push("");
  parts.push(
    ...(input.mergedReviewedOthers.length === 0
      ? ["_None._"]
      : input.mergedReviewedOthers.map((p) => prLine(p))),
  );
  parts.push("");

  parts.push("## Jira");
  parts.push("");
  if (!input.jiraConfigured) {
    parts.push("_Jira not configured._");
  } else if (input.jiraActivity.length === 0) {
    parts.push("_None._");
  } else {
    for (const t of input.jiraActivity) {
      const link = t.url ? `[${t.key}](${t.url})` : t.key;
      const res = t.resolutionName === "Unresolved" ? "" : ` · ${normalizeLf(t.resolutionName)}`;
      parts.push(`- ${link} — ${normalizeLf(t.summary)} — *${normalizeLf(t.status)}*${res}`);
    }
    if (input.jiraTruncated) {
      parts.push("");
      parts.push("_…truncated_");
    }
  }
  parts.push("");

  parts.push("## Git commits");
  parts.push("");
  const repoEntries = Object.entries(input.gitCommitsByRepo).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (repoEntries.length === 0) {
    parts.push("_No commits in this window._");
  } else {
    for (const [repoName, { subjects, truncated }] of repoEntries) {
      parts.push(`### ${repoName}`);
      parts.push("");
      for (const line of subjects) {
        parts.push(`- ${normalizeLf(line)}`);
      }
      if (truncated) {
        parts.push("");
        parts.push("_…truncated_");
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}
