import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createTask, findTask, writeItem } from "../../domains/tasks/store";
import { isTaskOpen, type Task } from "../../../../../packages/shared/tasks/types.ts";
import { buildTaskNoteMarkdown } from "../../../../../packages/shared/task-note/index.ts";
import { resolveStoredTaskNotes } from "../../../../../packages/shared/task-note/resolve.ts";
import { normalizeTaskNotePath } from "../../../../../packages/shared/task-note/update.ts";
import { applyTaskNoteOp, blockPlainText, type NoteBlock } from "../../../../../packages/shared/task-note/sections.ts";
import { textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import type { ServiceHandoffNoteRequest, ServicePickupRequest } from "../../../../../packages/shared/plugin-runtime";
import { getNotesDir } from "../content/dirs";
import { NotesStorage } from "../../domains/storage/notes";
import { assertSafePath } from "./filesystem";
import { assertPickupCheckout } from "./runtime-service-git";

export async function servicePickupOperation(request: ServicePickupRequest | ServiceHandoffNoteRequest, task: Task | null, directory: string, authorised: () => boolean) {
  if (request.operation === "pickup-create") {
    const repoName = await assertPickupCheckout(request.checkout, request.handoffId, request.repo);
    if (!authorised()) throw new Error("Service authorisation changed");
    if (task) {
      if (task.id !== request.handoffId || task.text !== request.title || task.jiraKey !== request.jiraKey || task.teamPickup?.handoffId !== request.handoffId || task.teamPickup.cwd !== request.checkout.cwd || task.teamPickup.branch !== request.checkout.branch) throw new Error("The pickup task already exists with different work");
      return task;
    }
    return createTask(directory, { id: request.handoffId, text: request.title, jiraKey: request.jiraKey ?? null, links: [{ kind: "repo", id: repoName, label: repoName }], stage: "draft", teamPickup: { handoffId: request.handoffId, ...request.checkout, status: "pending" } });
  }
  if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt) throw new Error("The task changed");
  if (request.operation === "pickup-note" || request.operation === "handoff-note" || request.operation === "handoff-note-read") {
    const pending = request.operation === "pickup-note"
      ? task.teamPickup?.handoffId === request.handoffId && task.teamPickup.status === "pending"
      : task.handoff?.handoffId === request.handoffId && task.handoff.status === "pending";
    if (!isTaskOpen(task) || !pending) throw new Error("The handoff is no longer pending");
    const configured = getNotesDir();
    const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
    const safeNote = (candidate: string) => {
      const notePath = normalizeTaskNotePath(candidate);
      assertSafePath(root, path.join(root, notePath + ".json"));
      return notePath;
    };
    const resolved = resolveStoredTaskNotes(task, task.startDate, { readTask: (_date, id) => findTask(directory, id) ?? undefined, noteExists: (candidate) => fs.existsSync(path.join(root, safeNote(candidate) + ".json")) });
    const notePath = safeNote(resolved.notePath);
    const storage = new NotesStorage(root);
    const existing = storage.read(notePath);
    const blocks = existing ? existing.content : textToBlocks(buildTaskNoteMarkdown({ id: task.id, date: task.startDate, text: task.text, jiraKey: task.jiraKey, notePath }));
    if (!Array.isArray(blocks)) throw new Error("The task note is unavailable");
    const headings = blocks.flatMap((block: NoteBlock, index: number) => block.type === "heading" && blockPlainText(block).trim() === "Handoff" ? [index] : []);
    if (headings.length > 1) throw new Error("The task note has multiple handoff sections");
    const start = headings[0];
    const end = start === undefined ? -1 : blocks.findIndex((block: NoteBlock, index: number) => index > start && block.type === "heading" && Number(block.props?.level ?? 2) <= 2);
    const current = start === undefined ? null : blocks.slice(start, end < 0 ? undefined : end);
    const revision = current ? crypto.createHash("sha256").update(JSON.stringify(current)).digest("hex") : null;
    if (request.operation === "handoff-note-read") return { revision };
    const section = (textToBlocks("## Handoff\n\n" + request.note) as NoteBlock[]).map((block, index) => index > 0 && block.type === "heading" && Number(block.props?.level ?? 2) < 3
      ? { ...block, props: { ...block.props, level: 3 } } : block);
    if (current && current.map(blockPlainText).join("\n") === section.map(blockPlainText).join("\n")) {
      return true;
    }
    if ((request.operation === "pickup-note" && current) || (request.operation === "handoff-note" && revision !== request.expected)) throw new Error("The handoff note changed");
    let next = start === undefined ? [...blocks, ...section] : [...blocks.slice(0, start), ...section, ...(end < 0 ? [] : blocks.slice(end))];
    const question = request.operation === "pickup-note" ? request.note.match(/(?:^|\n\n)Question: ([\s\S]*?)(?=\n\nBranch:|$)/)?.[1]?.trim() : undefined;
    if (question) next = applyTaskNoteOp(next, { op: "add_question", text: question }).blocks;
    if (!authorised()) throw new Error("Service authorisation changed");
    await storage.writeContent(notePath, next, existing?.revision ?? null);
    return true;
  }
  if (task.teamPickup?.handoffId !== request.handoffId) throw new Error("The pickup task changed");
  if (task.teamPickup.cwd !== request.checkout.cwd || task.teamPickup.branch !== request.checkout.branch) throw new Error("The pickup checkout changed");
  if (request.operation === "pickup-finish" && task.jiraKey !== request.jiraKey) throw new Error("The pickup Jira issue changed");
  if (request.operation === "pickup-finish" && task.teamPickup.status !== "pending") {
    if (!isTaskOpen(task) || task.jiraKey !== request.jiraKey) throw new Error("The pickup is already finished with different work");
    return task;
  }
  if (request.operation === "pickup-retire" && task.abandonedAt && task.teamPickup.status === "pending") return task;
  if (!isTaskOpen(task) || task.teamPickup.status !== "pending") throw new Error("The pickup is no longer pending");
  if (request.operation === "pickup-hold") return task;
  if (!authorised()) throw new Error("Service authorisation changed");
  if (request.operation === "pickup-finish") {
    const updated = { ...task, jiraKey: request.jiraKey, stage: undefined, teamPickup: { handoffId: request.handoffId, ...request.checkout } };
    writeItem(directory, updated);
    return updated;
  }
  const now = new Date().toISOString();
  const updated = { ...task, abandonedAt: now, endDate: now.slice(0, 10), abandonReason: "Handoff was declined or expired" };
  writeItem(directory, updated);
  return updated;
}
