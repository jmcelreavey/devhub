import fs from "node:fs";
import path from "node:path";
import { blocksToText } from "./markdown-convert";
import { listLearningEntries } from "./learnings-index";
import { getRepoRoot, getNotesDir } from "./notes-dir";
import { getTasks, isTaskOpen, type Task } from "./tasks-storage";
import { dailyNotePath, todayISO } from "./utils";

export interface ContextPackLearning {
  category: string;
  title: string;
  preview: string;
}

export interface ContextPack {
  generatedAt: string;
  today: string;
  openTasks: Array<Pick<Task, "id" | "text" | "due" | "jiraKey">>;
  recentLearnings: ContextPackLearning[];
  dailyNotePath: string;
  dailyNotePreview: string | null;
  standupMarkdown: string | null;
}

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

export async function buildContextPack(fetchStandup: () => Promise<string | null>): Promise<ContextPack> {
  const today = todayISO();
  const repoRoot = getRepoRoot();
  const tasks = getTasks(today).filter(isTaskOpen);
  const learnings = listLearningEntries(path.join(repoRoot, "notes", "learnings")).slice(0, 8);

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
    recentLearnings: learnings.map((l) => ({ category: l.category, title: l.title, preview: l.preview })),
    dailyNotePath: dailyNotePath(today),
    dailyNotePreview: readDailyNotePreview(getNotesDir(), today),
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
  lines.push("", "## Recent learnings");
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
