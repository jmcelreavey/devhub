import fs from "node:fs";
import path from "node:path";
import { findTask, invalidateTaskCache, withTaskLock, writeItem } from "../../domains/tasks/store";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { getNotesDir } from "../content/dirs";
import { answerRepoQuestion, replaceRepoLink } from "../storyboard/orchestrator";
import { orchestrationsDir, readOrchestration } from "../storyboard/orchestration-store";
import { assertSafePath } from "./filesystem";
import { readServiceQuestions, withServiceRepoQuestion } from "./runtime-service-questions";

interface RepoAnswer {
  taskId: string;
  createdAt: string;
  cwd: string;
  requestId: string;
  expected: { id: string; text: string };
}

export async function answerServiceRepoQuestion(request: RepoAnswer, directory: string, lockDirectory: string, authorised: () => boolean) {
  const configured = getNotesDir();
  const notesRoot = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  assertSafePath(notesRoot, path.join(orchestrationsDir(notesRoot), request.taskId + ".json"));
  const taskFile = path.join(directory, "items", request.taskId + ".json");
  const currentTask = () => {
    assertSafePath(directory, taskFile);
    const items = path.join(directory, "items");
    if (fs.existsSync(items)) for (const name of fs.readdirSync(items)) {
      if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(items, name));
    }
    invalidateTaskCache(directory);
    const task = findTask(directory, request.taskId);
    return task && task.id === request.taskId && task.createdAt === request.createdAt && isTaskOpen(task) && !isTaskOwnershipBlocked(task) ? task : null;
  };
  const valid = () => authorised() && !!currentTask();
  if (!valid()) throw new Error("The task or service authorisation changed");
  const record = readOrchestration(request.taskId, notesRoot);
  if (!record) throw new Error("The task is not waiting on an orchestration");
  const matches = record.questions.filter((question) => question.id === request.expected.id);
  if (matches.length !== 1 || matches[0].kind !== "repo" || matches[0].prompt !== request.expected.text) throw new Error("The question changed");
  const replay = record.idempotency.some((entry) => entry.key === request.requestId);
  if (replay && (matches[0].state !== "answered" || path.resolve(record.repo?.cwd ?? "") !== path.resolve(request.cwd))) throw new Error("The request id belongs to another answer");
  const origin = record.auto?.origin ?? new URL(process.env.DEVHUB_BASE_URL || `http://${process.env.DEVHUB_BIND_HOST || "localhost"}:${process.env.PORT || "1337"}`).origin;
  const result = await answerRepoQuestion({ action: "answer-repo", taskId: request.taskId, taskDate: record.taskDate, cwd: request.cwd, idempotencyKey: request.requestId }, { origin }, undefined, notesRoot, {
    question: request.expected,
    authorised: valid,
    linkRepo: async (_taskId, _date, repoName, previousRepoName) => withTaskLock(lockDirectory, () => {
      const task = currentTask();
      if (!task || !authorised()) throw new Error("The task or service authorisation changed");
      withServiceRepoQuestion(task, directory, request.expected, () => {
        if (!authorised()) throw new Error("Service authorisation changed");
        writeItem(directory, { ...task, links: replaceRepoLink(task.links, repoName, previousRepoName) });
      });
      if (directory !== lockDirectory) invalidateTaskCache(lockDirectory);
    }),
  });
  if (!valid()) throw new Error("The task or service authorisation changed");
  return { remaining: readServiceQuestions(currentTask(), directory).questions.length, runId: result.runId, dispatchError: result.dispatchError, replayed: result.replayed };
}
