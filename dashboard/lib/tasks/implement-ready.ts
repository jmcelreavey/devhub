/**
 * Light ready-to-implement checklist (P3).
 *
 * Pure evaluation only — callers gather note markdown, Jira description text,
 * repo links, and open prerequisite/blocker tasks. Default mode is warn; a
 * hard-block setting flips Launch to refuse until items pass.
 */

export type ImplementReadyItemId = "acceptance" | "questions" | "repo" | "prerequisites";

export interface ImplementReadyItem {
  id: ImplementReadyItemId;
  ok: boolean;
  label: string;
  detail?: string;
  /** In-app path to fix the gap (note, work day, prerequisite task). */
  fixHref?: string;
  fixLabel?: string;
}

export interface OpenPrerequisiteBlocker {
  id: string;
  text: string;
  date?: string;
}

export interface ImplementReadyInput {
  /** Task note body as markdown (null when the note does not exist). */
  noteMarkdown: string | null;
  /** Plain text from the Jira description (null when no key / fetch failed). */
  jiraDescriptionText: string | null;
  hasJiraKey: boolean;
  /** `kind: "repo"` link ids on the task. */
  repoIds: string[];
  /** Modal pick when more than one repo is linked. */
  selectedRepoId?: string | null;
  /** Hub checkout repo — satisfies the repo item when links are empty. */
  hubRepoId?: string | null;
  openPrerequisiteBlockers: OpenPrerequisiteBlocker[];
  hardBlock: boolean;
  /**
   * The Implement dialog counts an existing task note as the plan (you wrote or
   * generated it; the agent reads it either way). Stage → ready sets this so
   * only a real Plan / Acceptance section passes.
   */
  requirePlanSection?: boolean;
  notePath?: string;
  taskDate?: string;
}

export interface ImplementReadyResult {
  /** Every checklist item passed. */
  ok: boolean;
  hardBlock: boolean;
  /** hardBlock && !ok — Launch should refuse. */
  blocked: boolean;
  /** !ok && !hardBlock — show warnings but allow Launch. */
  warn: boolean;
  items: ImplementReadyItem[];
  /** Effective repo after single-link or modal pick (null when unresolved). */
  selectedRepoId: string | null;
}

/** Tags that mark a linked task as a prerequisite / blocker for implement. */
export const IMPLEMENT_PREREQUISITE_TAGS = ["prerequisite", "prereq", "blocker"] as const;

const PLAN_HEADING_RE = /^##\s+(Plan|Acceptance(?:\s+criteria)?)\b.*$/gim;

/** True when markdown has a ## Plan / ## Acceptance section with real body text. */
export function noteHasPlanOrAcceptanceSection(markdown: string | null | undefined): boolean {
  if (!markdown) return false;
  const text = markdown.replace(/\r\n/g, "\n");
  PLAN_HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAN_HEADING_RE.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const rest = text.slice(start);
    const nextHeading = rest.search(/\n##\s+/);
    const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
    if (sectionBodyHasContent(body)) return true;
  }
  return false;
}

/** Placeholder scaffolds like "- " / empty checkboxes do not count. */
export function sectionBodyHasContent(body: string): boolean {
  const meaningful = body
    .split("\n")
    .map((line) =>
      line
        .replace(/^[-*+]\s*(\[[ xX]\])?\s*/, "")
        .replace(/^>\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  return meaningful.some((line) => line.length >= 3);
}

const OPEN_QUESTIONS_HEADING_RE = /^##\s+Open\s+questions\b.*$/im;

/**
 * Unanswered lines under `## Open questions`. A checked box (`- [x]`) is an
 * answered question; placeholder bullets don't count. A plan with open
 * questions stays a draft — the agent would have to ask them.
 */
export function noteOpenQuestions(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const text = markdown.replace(/\r\n/g, "\n");
  const match = OPEN_QUESTIONS_HEADING_RE.exec(text);
  if (!match) return [];
  const rest = text.slice(match.index + match[0].length);
  const nextHeading = rest.search(/\n##\s+/);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return body
    .split("\n")
    .filter((line) => !/^\s*[-*+]\s*\[[xX]\]/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s*(\[ \])?\s*/, "").trim())
    .filter((line) => line.length >= 3);
}

export function jiraDescriptionHasContent(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.replace(/\s+/g, " ").trim().length >= 8;
}

export function taskTextHasPrerequisiteTag(text: string): boolean {
  const lower = text.toLowerCase();
  return IMPLEMENT_PREREQUISITE_TAGS.some((tag) => {
    const re = new RegExp(`(?:^|[\\s(])#${tag}\\b`);
    return re.test(lower);
  });
}

/**
 * Evaluate the light implement-ready gate.
 * Missing items stay warnings unless `hardBlock` is true.
 */
export function evaluateImplementReady(input: ImplementReadyInput): ImplementReadyResult {
  const linked = input.repoIds.map((id) => id.trim()).filter(Boolean);
  const hub = input.hubRepoId?.trim() || null;
  // Hub checkout counts as a repo when the task has no repo links yet.
  const repoIds = linked.length > 0 ? linked : hub ? [hub] : [];
  const preferred = input.selectedRepoId?.trim() || hub;
  const selected =
    preferred && repoIds.some((id) => id.toLowerCase() === preferred.toLowerCase())
      ? repoIds.find((id) => id.toLowerCase() === preferred.toLowerCase()) ?? null
      : repoIds.length === 1
        ? repoIds[0]!
        : null;

  const hasPlanSection = noteHasPlanOrAcceptanceSection(input.noteMarkdown);
  const hasJiraDescription = jiraDescriptionHasContent(input.jiraDescriptionText);
  const noteExists = input.noteMarkdown !== null;
  const noteHref = input.notePath && noteExists ? `/notes/${input.notePath}` : undefined;

  const acceptance: ImplementReadyItem =
    hasPlanSection || hasJiraDescription || (noteExists && !input.requirePlanSection)
      ? {
          id: "acceptance",
          ok: true,
          label: "Acceptance / plan",
          detail: hasPlanSection
            ? "Task note has a Plan or Acceptance section"
            : hasJiraDescription
              ? "Jira description present"
              : "Task note exists",
          fixHref: noteHref,
          fixLabel: noteHref ? "Open task note" : undefined,
        }
      : {
          id: "acceptance",
          ok: false,
          label: "Acceptance / plan",
          detail: input.hasJiraKey
            ? "Add a Jira description or a ## Plan / ## Acceptance section in the task note"
            : "Add a ## Plan or ## Acceptance section in the task note",
          fixHref: noteHref,
          fixLabel: noteHref ? "Open task note" : undefined,
        };

  const openQuestions = noteOpenQuestions(input.noteMarkdown);
  const questions: ImplementReadyItem =
    openQuestions.length === 0
      ? { id: "questions", ok: true, label: "Open questions", detail: "None left unanswered" }
      : {
          id: "questions",
          ok: false,
          label: "Open questions",
          detail: openQuestions.slice(0, 3).join("; ").slice(0, 200),
          fixHref: input.notePath ? `/notes/${input.notePath}` : undefined,
          fixLabel: input.notePath ? "Answer them in the task note" : undefined,
        };

  let repo: ImplementReadyItem;
  if (selected) {
    repo = {
      id: "repo",
      ok: true,
      label: "Repo link",
      detail: repoIds.length === 1 ? `Linked repo: ${selected}` : `Using selected repo: ${selected}`,
    };
  } else if (repoIds.length === 0) {
    repo = {
      id: "repo",
      ok: false,
      label: "Repo link",
      detail: "Link exactly one repo (or pick one here when several are linked)",
      fixHref: input.taskDate ? `/work?date=${encodeURIComponent(input.taskDate)}&tab=tasks` : "/work?tab=tasks",
      fixLabel: "Open task to add a repo link",
    };
  } else {
    repo = {
      id: "repo",
      ok: false,
      label: "Repo link",
      detail: `Pick one of ${repoIds.length} linked repos before launching`,
      fixHref: input.taskDate ? `/work?date=${encodeURIComponent(input.taskDate)}&tab=tasks` : "/work?tab=tasks",
      fixLabel: "Review repo links",
    };
  }

  const openBlockers = input.openPrerequisiteBlockers;
  const prerequisites: ImplementReadyItem =
    openBlockers.length === 0
      ? {
          id: "prerequisites",
          ok: true,
          label: "Prerequisites",
          detail: "No open #prerequisite / #blocker tasks",
        }
      : {
          id: "prerequisites",
          ok: false,
          label: "Prerequisites",
          detail: openBlockers
            .map((b) => b.text.replace(/\s+/g, " ").trim().slice(0, 80))
            .join("; "),
          fixHref: openBlockers[0]?.date
            ? `/work?date=${encodeURIComponent(openBlockers[0].date)}&tab=tasks`
            : "/work?tab=tasks",
          fixLabel:
            openBlockers.length === 1
              ? "Open prerequisite task"
              : `Open ${openBlockers.length} open prerequisites`,
        };

  const items = [acceptance, questions, repo, prerequisites];
  const ok = items.every((item) => item.ok);
  const hardBlock = Boolean(input.hardBlock);
  return {
    ok,
    hardBlock,
    blocked: hardBlock && !ok,
    warn: !ok && !hardBlock,
    items,
    selectedRepoId: selected,
  };
}
