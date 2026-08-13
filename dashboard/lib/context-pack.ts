/**
 * The one-click "context pack" — today's state, ready to paste into an agent.
 *
 * ## What changed, and what deliberately didn't
 *
 * `lib/recall/recall.ts` opens by saying it replaces this file, and for the part
 * it named it was right: learnings were selected by `.slice(0, 8)`, which is
 * recency masquerading as relevance. It paid for eight learnings when one
 * mattered and never surfaced the note from March that held the answer.
 *
 * But "replace context-pack with recall" doesn't survive contact with the entry
 * point. `recall(query)` needs a query; this is a button with no query — the
 * user clicks it and expects today's context. Deleting the route in favour of
 * `/api/recall?q=…` would move that problem onto the user, who would have to
 * describe their own day before the tool could tell them about it.
 *
 * So the split is by what each half is actually good at:
 *
 *  - **Facts about today** — open tasks, the daily note, standup — stay direct
 *    reads. These aren't retrieval. There is no ranking question in "what tasks
 *    are open"; running them through a scorer would only add ways to be wrong.
 *  - **Learnings** now come from `recall`, with the query *synthesised from
 *    those facts*: open task text, Jira keys, and the daily note. The pack
 *    answers "what have I learned that bears on what I'm doing today" instead of
 *    "what did I write down most recently".
 *
 * ## Falling back is a normal path, not an error
 *
 * The recall index is built on demand and can be absent, stale, or empty on a
 * fresh machine — and with no open tasks and an empty daily note there is
 * genuinely nothing to be relevant *to*. In all of those cases this falls back
 * to the old recency behaviour and says so in `learningSelection`, because a
 * context pack that returns nothing is worse than one that returns the eight
 * most recent things and admits that's what it did.
 */
import fs from "node:fs";
import path from "node:path";
import { blocksToText } from "./markdown-convert";
import { listLearningEntries } from "./learnings-index";
import { getRepoRoot, getNotesDir } from "@/lib/notes/dir";
import { getTasks, isTaskOpen, type Task } from "@/lib/tasks/storage";
import { recall } from "@/lib/recall/recall";
import { dailyNotePath, todayISO } from "./utils";

export interface ContextPackLearning {
  category: string;
  title: string;
  preview: string;
}

/**
 * How the learnings in this pack were chosen.
 *
 * Surfaced rather than inferred: "these are relevant to your open tasks" and
 * "these are just the most recent" are very different claims, and a reader
 * pasting this into an agent deserves to know which one they got.
 */
export type LearningSelection =
  /** Ranked by `recall` against a query built from today's work. */
  | "relevant"
  /** No open tasks and no daily note — nothing to be relevant to. */
  | "recent-no-query"
  /** Recall returned nothing usable (missing/empty index, or no hits). */
  | "recent-no-index";

export interface ContextPack {
  generatedAt: string;
  today: string;
  openTasks: Array<Pick<Task, "id" | "text" | "due" | "jiraKey">>;
  recentLearnings: ContextPackLearning[];
  /** Why `recentLearnings` holds what it holds. */
  learningSelection: LearningSelection;
  /** The synthesised query, when one was used. Kept so the result is explicable. */
  learningQuery: string | null;
  dailyNotePath: string;
  dailyNotePreview: string | null;
  standupMarkdown: string | null;
}

/** How many learnings the pack carries, under either selection strategy. */
const LEARNING_LIMIT = 8;

function readDailyNotePreview(notesDir: string, today: string): string | null {
  const filePath = path.join(notesDir, "daily", `${today}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const blocks = JSON.parse(raw) as unknown;
    const text = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
    return text.slice(0, 1200) || null;
  } catch {
    return null;
  }
}

/**
 * Build the retrieval query from what's actually on the user's plate.
 *
 * Jira keys go in twice — once as themselves and once via the task text that
 * mentions them — because `recall` extracts entity refs from the query and
 * scores chunks that share them. A pack built on a day of `PTF-3774` work
 * should surface the note about `PTF-3774`, and the entity signal is what makes
 * that happen rather than hoping the prose overlaps.
 *
 * The daily note is truncated: it is prose, and past a point it stops being a
 * description of today's work and starts being noise that dilutes the task
 * terms it's meant to support.
 */
export function buildLearningQuery(
  tasks: Array<Pick<Task, "text" | "jiraKey">>,
  dailyNotePreview: string | null,
): string {
  const parts: string[] = [];
  for (const task of tasks) {
    if (task.text?.trim()) parts.push(task.text.trim());
    if (task.jiraKey) parts.push(task.jiraKey);
  }
  if (dailyNotePreview?.trim()) parts.push(dailyNotePreview.slice(0, 600));
  return parts.join(" ").trim();
}

function recentLearnings(repoRoot: string): ContextPackLearning[] {
  return listLearningEntries(path.join(repoRoot, "notes", "learnings"))
    .slice(0, LEARNING_LIMIT)
    .map((l) => ({ category: l.category, title: l.title, preview: l.preview }));
}

/**
 * Rank learnings against the day's query, or fall back to recency.
 *
 * Recall is wrapped in a try/catch because a context pack must not fail: it is
 * a convenience button, and the honest degraded answer ("here are the recent
 * ones") beats a toast saying the index is missing.
 */
function selectLearnings(
  repoRoot: string,
  query: string,
): { learnings: ContextPackLearning[]; selection: LearningSelection; query: string | null } {
  if (!query) {
    return { learnings: recentLearnings(repoRoot), selection: "recent-no-query", query: null };
  }

  try {
    const result = recall({
      query,
      limit: LEARNING_LIMIT,
      kinds: ["learning"],
      // Learnings are prose written at different times about recurring problems,
      // so the exact words rarely match. Lean on the vector half more than the
      // 0.5 default, but not all the way — a Jira key in the query is a lexical
      // match worth keeping.
      alpha: 0.65,
    });

    if (result.hits.length === 0) {
      return { learnings: recentLearnings(repoRoot), selection: "recent-no-index", query };
    }

    return {
      learnings: result.hits.map((hit) => ({
        category: hit.chunk.sourceId,
        title: hit.chunk.title,
        preview: hit.snippet,
      })),
      selection: "relevant",
      query,
    };
  } catch {
    return { learnings: recentLearnings(repoRoot), selection: "recent-no-index", query };
  }
}

export async function buildContextPack(fetchStandup: () => Promise<string | null>): Promise<ContextPack> {
  const today = todayISO();
  const repoRoot = getRepoRoot();
  const tasks = getTasks(today).filter(isTaskOpen);
  const dailyNotePreview = readDailyNotePreview(getNotesDir(), today);
  const learnings = selectLearnings(repoRoot, buildLearningQuery(tasks, dailyNotePreview));

  let standupMarkdown: string | null = null;
  try {
    standupMarkdown = await fetchStandup();
  } catch {
    standupMarkdown = null;
  }

  return {
    generatedAt: new Date().toISOString(),
    today,
    openTasks: tasks.map((t) => ({ id: t.id, text: t.text, due: t.due, jiraKey: t.jiraKey })),
    recentLearnings: learnings.learnings,
    learningSelection: learnings.selection,
    learningQuery: learnings.query,
    dailyNotePath: dailyNotePath(today),
    dailyNotePreview,
    standupMarkdown,
  };
}

export function formatContextPackMarkdown(pack: ContextPack): string {
  const lines: string[] = [`# DevHub context pack — ${pack.today}`, "", `_Generated ${pack.generatedAt}_`, "", "## Open tasks"];
  if (pack.openTasks.length === 0) lines.push("- (none)");
  else {
    for (const t of pack.openTasks) {
      const due = t.due ? ` (due ${t.due})` : "";
      const jira = t.jiraKey ? ` [${t.jiraKey}]` : "";
      lines.push(`- ${t.text}${jira}${due}`);
    }
  }
  // The heading states the selection because this markdown gets pasted into an
  // agent, and "relevant to today" vs "most recent" changes how much weight the
  // reader should give it. A silent fallback would read as the stronger claim.
  const LEARNING_HEADING: Record<LearningSelection, string> = {
    relevant: "## Learnings relevant to today",
    "recent-no-query": "## Recent learnings\n\n_No open tasks or daily note yet, so these are the most recent rather than the most relevant._",
    "recent-no-index": "## Recent learnings\n\n_Recall returned no matches, so these are the most recent rather than the most relevant._",
  };
  lines.push("", LEARNING_HEADING[pack.learningSelection] ?? "## Recent learnings");
  if (pack.recentLearnings.length === 0) lines.push("- (none)");
  else {
    for (const l of pack.recentLearnings) {
      lines.push(`- **${l.title}** (\`${l.category}\`)`);
      if (l.preview.trim()) lines.push(`  ${l.preview.split("\n")[0]}`);
    }
  }
  if (pack.dailyNotePreview) lines.push("", `## Daily note (\`${pack.dailyNotePath}\`)`, "", pack.dailyNotePreview);
  if (pack.standupMarkdown) lines.push("", "## Standup", "", pack.standupMarkdown);
  return lines.join("\n");
}
