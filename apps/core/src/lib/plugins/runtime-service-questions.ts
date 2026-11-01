import fs from "node:fs";
import path from "node:path";
import { findTask, invalidateTaskCache } from "../../domains/tasks/store";
import { isTaskOpen, isTaskOwnershipBlocked, type Task } from "../../../../../packages/shared/tasks/types.ts";
import { resolveStoredTaskNotes } from "../../../../../packages/shared/task-note/resolve.ts";
import { normalizeTaskNotePath, updateTaskNote } from "../../../../../packages/shared/task-note/update.ts";
import { getNotesDir } from "../content/dirs";
import { NotesStorage } from "../../domains/storage/notes";
import { orchestrationsDir, readOrchestration } from "../storyboard/orchestration-store";
import { assertSafePath } from "./filesystem";
import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content.ts";
import { jsonVaultCodec } from "../../../../../packages/shared/vault/vault-codec.ts";

interface ServiceQuestion {
  id: string;
  text: string;
  kind: "note" | "repo";
  options?: string[];
}

function questionSources(task: Task, directory: string) {
  const configured = getNotesDir();
  const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const safeNote = (candidate: string) => {
    const notePath = normalizeTaskNotePath(candidate);
    assertSafePath(root, path.join(root, notePath + ".json"));
    return notePath;
  };
  const resolved = resolveStoredTaskNotes(task, task.startDate, {
    readTask: (_date, id) => findTask(directory, id) ?? undefined,
    noteExists: (candidate) => fs.existsSync(path.join(root, safeNote(candidate) + ".json")),
  });
  const notePath = safeNote(resolved.notePath);
  const storage = new NotesStorage(root);
  assertSafePath(root, path.join(orchestrationsDir(root), task.id + ".json"));
  const repo = readOrchestration(task.id, root)?.questions ?? [];
  const repoQuestions: ServiceQuestion[] = repo
    .filter((question) => question.kind === "repo" && question.state === "open")
    .sort((left, right) => left.askedAt.localeCompare(right.askedAt))
    .map((question) => ({ id: question.id, text: question.prompt, kind: "repo" }));
  const existing = storage.read(notePath);
  const note = existing
    ? updateTaskNote({ read: () => existing, write: () => { throw new Error("Read-only note"); } }, notePath, { op: "read" }, { notesRoot: root }).view.questions : [];
  const noteQuestions: ServiceQuestion[] = note.filter((question) => !question.resolved)
    .map((question) => ({ id: question.id, text: question.text, kind: "note", ...(question.options?.length ? { options: question.options } : {}) }));
  return { root, storage, existing, notePath, questions: [...repoQuestions, ...noteQuestions], ids: [...repo.map((question) => question.id), ...note.map((question) => question.id)] };
}

export function readServiceQuestions(task: Task | null, directory: string) {
  if (!task || !isTaskOpen(task) || isTaskOwnershipBlocked(task)) return { closed: true, questions: [] };
  return { closed: false, questions: questionSources(task, directory).questions };
}

export function withServiceRepoQuestion<T>(task: Task, directory: string, expected: { id: string; text: string }, work: () => T): T {
  const source = questionSources(task, directory);
  return source.storage.withLock(source.notePath, () => {
    const current = questionSources(task, directory);
    const matches = current.questions.filter((question) => question.id === expected.id);
    if (current.notePath !== source.notePath || current.ids.filter((id) => id === expected.id).length !== 1 || matches.length !== 1 || matches[0].kind !== "repo" || matches[0].text !== expected.text) throw new Error("The question changed or is ambiguous");
    return work();
  });
}

export async function answerServiceQuestion(task: Task | null, directory: string, expected: { id: string; text: string; option?: string }, answer: string, authorised: () => boolean) {
  if (!task || !isTaskOpen(task) || isTaskOwnershipBlocked(task)) throw new Error("Task is no longer available");
  const current = questionSources(task, directory);
  const existing = current.existing;
  const matches = current.questions.filter((question) => question.id === expected.id);
  if (matches.length !== 1 || current.ids.filter((id) => id === expected.id).length !== 1 || matches[0].text !== expected.text || (expected.option !== undefined && (expected.option !== answer || !matches[0].options?.includes(expected.option)))) throw new Error("The question changed or was already answered");
  if (matches[0].kind !== "note") throw new Error("Repository questions cannot be answered through this service");
  if (!authorised()) throw new Error("Service is not authorised");
  let updated: unknown;
  updateTaskNote({
    read: () => existing,
    write: (_path, blocks) => { updated = blocks; },
  }, current.notePath, { op: "resolve_question", id: expected.id, answer }, { notesRoot: current.root });
  // The write uses the same bytes whose questions were checked above.
  if (updated !== undefined) {
    const writer = createFileContentStorage(current.root, { beforeWrite: () => {
      if (!authorised()) throw new Error("Service is not authorised");
      const items = path.join(directory, "items");
      assertSafePath(directory, path.join(items, task.id + ".json"));
      if (fs.existsSync(items)) for (const name of fs.readdirSync(items)) {
        if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(items, name));
      }
      invalidateTaskCache(directory);
      const latest = findTask(directory, task.id);
      if (!latest || JSON.stringify(latest) !== JSON.stringify(task)) throw new Error("The task changed");
      const source = questionSources(latest, directory);
      const same = source.questions.filter((question) => question.id === expected.id);
      if (source.notePath !== current.notePath || source.ids.filter((id) => id === expected.id).length !== 1 || same.length !== 1 || same[0].kind !== "note" || same[0].text !== expected.text || (expected.option !== undefined && !same[0].options?.includes(expected.option))) throw new Error("The question changed or was already answered");
      if (!authorised()) throw new Error("Service is not authorised");
    } });
    await writer.write(current.notePath + ".json", jsonVaultCodec.serialize(updated), existing?.revision ?? null);
  }
  return { question: matches[0], remaining: readServiceQuestions(task, directory).questions.length };
}
