// One-off background research tasks. Ask for something ("dig into what's on for
// the kids in NI this weekend", "research the new GLM release") and it runs in
// the background while you get on with your day; the result is saved as markdown
// so you can come back to it later. Reuses the Last30Days script when it's
// installed, and falls back to an AI-written brief when it isn't.
//
// Fire-and-forget: the Next server is long-lived, so we kick the runner off
// without awaiting it and persist status to disk. Tasks orphaned by a restart
// are reaped on the next read.

import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { runLast30DaysForInterests } from "@/lib/last30days-runner";
import { loadResearchCards, researchDir } from "@/lib/briefing-research";
import { todayISO } from "@/lib/utils";

export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface ResearchTask {
  id: string;
  topic: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** Repo-relative path to the saved markdown, when done. */
  resultPath?: string;
  /** Short preview of the result. */
  summary?: string;
  /** "last30days" or "ai" — how the brief was produced. */
  via?: string;
  error?: string;
}

const TASKS_VERSION = 1;
const STALE_MS = 20 * 60 * 1000;

interface StoredTasks {
  version: number;
  tasks: ResearchTask[];
}

function tasksFile(): string {
  return path.join(getRepoRoot(), "notes", ".cache", "briefing", "tasks.json");
}

function readRaw(): ResearchTask[] {
  const stored = safeReadJSON<StoredTasks | null>(tasksFile(), null);
  return stored && Array.isArray(stored.tasks) ? stored.tasks : [];
}

async function writeRaw(tasks: ResearchTask[]): Promise<void> {
  const file = tasksFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify({ version: TASKS_VERSION, tasks } satisfies StoredTasks, null, 2));
}

async function updateTask(id: string, patch: Partial<ResearchTask>): Promise<void> {
  await withMutex(tasksFile(), async () => {
    const tasks = readRaw();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    await writeRaw(tasks);
  });
}

/** Reap tasks left "running"/"queued" by a server restart. */
function reap(tasks: ResearchTask[]): ResearchTask[] {
  const now = Date.now();
  let changed = false;
  const next = tasks.map((t) => {
    if ((t.status === "running" || t.status === "queued") && now - new Date(t.updatedAt).getTime() > STALE_MS) {
      changed = true;
      return { ...t, status: "failed" as const, error: "timed out", updatedAt: new Date().toISOString() };
    }
    return t;
  });
  if (changed) void writeRaw(next).catch(() => undefined);
  return next;
}

export function listTasks(): ResearchTask[] {
  return reap(readRaw()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(id: string): ResearchTask | null {
  return readRaw().find((t) => t.id === id) ?? null;
}

export function getTaskResultMarkdown(id: string): string | null {
  const task = getTask(id);
  if (!task?.resultPath) return null;
  const abs = path.join(getRepoRoot(), task.resultPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
  } catch {
    return null;
  }
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "topic";
}

async function aiBrief(topic: string): Promise<{ markdown: string } | null> {
  if (!isNotesAiConfigured()) return null;
  const model = getNotesAiModel();
  if (!model) return null;
  try {
    const result = await generateText({
      model,
      maxOutputTokens: 1400,
      ...getNotesAiCallOptions(),
      prompt: [
        "Write a concise, useful research brief on the topic below for a personal briefing.",
        "Format as markdown: a single # title, a 2-3 sentence overview, then a short bulleted list of the most useful specifics, angles, or things to check.",
        "Be concrete. If you are unsure of very recent facts, say so rather than inventing them. No preamble.",
        "",
        "Topic: " + topic,
      ].join("\n"),
    });
    const md = result.text?.trim();
    return md && md.length > 40 ? { markdown: md } : null;
  } catch {
    return null;
  }
}

function firstParagraph(markdown: string): string {
  const line = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("*"));
  return (line ?? markdown).replace(/\s+/g, " ").slice(0, 240);
}

async function runTask(task: ResearchTask): Promise<void> {
  await updateTask(task.id, { status: "running" });
  try {
    // 1) Prefer the Last30Days script (real, source-backed research).
    const result = await runLast30DaysForInterests([task.topic], { onlyMissing: false }).catch(() => null);
    if (result?.script && result.failed.length === 0) {
      const cards = loadResearchCards([task.topic]);
      const card = cards[0];
      if (card) {
        await updateTask(task.id, {
          status: "done",
          via: "last30days",
          resultPath: card.sourcePath,
          summary: card.summary,
        });
        return;
      }
    }

    // 2) Fall back to an AI-written brief saved alongside other research.
    const brief = await aiBrief(task.topic);
    if (brief) {
      const dir = researchDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, slug(task.topic) + "-" + todayISO() + ".md");
      fs.writeFileSync(file, brief.markdown, "utf-8");
      await updateTask(task.id, {
        status: "done",
        via: "ai",
        resultPath: path.relative(getRepoRoot(), file),
        summary: firstParagraph(brief.markdown),
      });
      return;
    }

    await updateTask(task.id, {
      status: "failed",
      error: "No research backend available (Last30Days script not found and AI not configured).",
    });
  } catch (err) {
    await updateTask(task.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Create a background research task and kick it off. */
export async function createResearchTask(topic: string): Promise<ResearchTask | null> {
  const clean = topic.trim().slice(0, 200);
  if (clean.length < 3) return null;

  const now = new Date().toISOString();
  const task: ResearchTask = {
    id: slug(clean) + "-" + Date.now().toString(36),
    topic: clean,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  await withMutex(tasksFile(), async () => {
    const tasks = readRaw();
    tasks.push(task);
    await writeRaw(tasks);
  });

  // Fire-and-forget — the server outlives the request.
  void runTask(task).catch(() => undefined);
  return task;
}
