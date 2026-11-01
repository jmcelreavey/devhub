import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { findTask } from "../../domains/tasks/store";
import { isTaskOwnershipBlocked, type Task } from "../../../../../packages/shared/tasks/types.ts";
import { resolveStoredTaskNotes } from "../../../../../packages/shared/task-note/resolve.ts";
import { normalizeTaskNotePath, updateTaskNote } from "../../../../../packages/shared/task-note/update.ts";
import { blocksToText } from "../../../../../packages/shared/markdown-convert/index.ts";
import { getNotesDir } from "../content/dirs";
import { resolveLocalGithubRepos } from "../repos/resolution";
import { NotesStorage } from "../../domains/storage/notes";
import { orchestrationsDir, readOrchestration } from "../storyboard/orchestration-store";
import { taskAgentRunsPath } from "../../domains/tasks/task-agent-runs";
import { assertSafePath } from "./filesystem";

const runFile = z.object({
  handoff: z.unknown().optional(),
  runs: z.array(z.object({
    runId: z.string(), status: z.enum(["queued", "running", "paused", "done", "failed", "abandoned"]),
    startedAt: z.string(), updatedAt: z.string(), cwd: z.string().optional(), branch: z.string().optional(), prUrl: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

function readTaskRuns(file: string) {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], handoff: "" };
    throw error;
  }
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Task run context is too large");
  const value = runFile.parse(JSON.parse(raw));
  return {
    runs: (value.runs ?? []).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    handoff: typeof value.handoff === "string" ? value.handoff : "",
  };
}

export async function runtimeServiceTaskContext(task: Task, directory: string, profile: string) {
  if (task.done || task.abandonedAt || isTaskOwnershipBlocked(task)) throw new Error("Task is no longer available");
  const configuredNotes = getNotesDir();
  const notesRoot = fs.existsSync(configuredNotes) ? fs.realpathSync(configuredNotes) : path.resolve(configuredNotes);
  const safeNote = (candidate: string) => {
    const notePath = normalizeTaskNotePath(candidate);
    assertSafePath(notesRoot, path.join(notesRoot, notePath + ".json"));
    return notePath;
  };
  const resolved = resolveStoredTaskNotes(task, task.startDate, {
    readTask: (_date, id) => findTask(directory, id) ?? undefined,
    noteExists: (candidate) => fs.existsSync(path.join(notesRoot, safeNote(candidate) + ".json")),
  });
  const notePath = safeNote(resolved.notePath);
  const storage = new NotesStorage(notesRoot);
  const view = updateTaskNote(storage, notePath, { op: "read" }, { notesRoot }).view;
  const content = storage.read(notePath)?.content;
  if (!Array.isArray(content)) throw new Error("Task note is unavailable");
  const markdown = blocksToText(content);
  const plan = markdown.match(/^## (?:Plan|Acceptance)[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.slice(0, 600) ?? "";
  const runPath = taskAgentRunsPath(task.id, notesRoot);
  assertSafePath(notesRoot, runPath);
  assertSafePath(notesRoot, path.join(orchestrationsDir(notesRoot), task.id + ".json"));
  const { runs, handoff } = readTaskRuns(runPath);
  const latest = runs[0];
  const orchestration = readOrchestration(task.id, notesRoot);
  const repoQuestions = orchestration?.questions.filter((question) => question.kind === "repo" && question.state === "open")
    .sort((left, right) => left.askedAt.localeCompare(right.askedAt))
    .map((question) => ({ id: question.id, text: question.prompt })) ?? [];
  const noteQuestions = view.questions.filter((question) => !question.resolved).map((question) => ({ id: question.id, text: question.text }));
  const repo = task.links?.find((link) => link.kind === "repo");
  const local = repo ? (await resolveLocalGithubRepos()).find((entry) => [entry.fullName, entry.repo.name].includes(repo.id)) : undefined;
  const cwd = task.teamPickup?.cwd ?? latest?.cwd ?? orchestration?.repo?.cwd ?? local?.repo.path;
  const snapshot = {
    task, profile, question: repoQuestions[0] ?? noteQuestions[0] ?? { id: "", text: "" },
    view: { summary: view.summary, ...(view.statusUpdate ? { statusUpdate: view.statusUpdate } : {}) },
    markdown: plan ? "## Plan\n" + plan : "", runs, handoff: latest ? handoff.slice(0, 800) : "", cwd,
  };
  return { ...snapshot, review: crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}
