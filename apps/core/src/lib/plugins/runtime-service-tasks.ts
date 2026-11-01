import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { findTask, invalidateTaskCache, withTaskLock, writeItem } from "../../domains/tasks/store";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { isValidProfileId, listTaskProfiles, resolveActiveProfileId } from "../../../../../packages/shared/vault/task-profiles.ts";
import type { ServiceTaskProfiles } from "../../../../../packages/shared/plugin-runtime";
import { getTasksDir } from "../content/dirs";
import { assertSafePath } from "./filesystem";
import { runtimeServiceTaskContext } from "./runtime-service-task-context";
import { readServiceQuestions, answerServiceQuestion } from "./runtime-service-questions";
import { serviceTaskRunOperation } from "./runtime-service-runs";
import { answerServiceRepoQuestion } from "./runtime-service-repo-answer";
import { servicePickupOperation } from "./runtime-service-pickup";
import { RuntimeServiceGit } from "./runtime-service-git";
import { serviceJiraOperation } from "./runtime-service-jira";
import { serviceBoardSnapshot } from "./runtime-service-board";
import { servicePluginNeeds } from "./runtime-service-plugin-needs";
import { serviceWorkflowOperation } from "./runtime-service-workflow";
import { serviceRunUsage } from "./runtime-service-run-usage";
import { serviceTaskDispatch } from "./runtime-service-dispatch";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const profile = z.string().refine((value) => value === "legacy" || isValidProfileId(value));
const handoff = z.object({
  handoffId: id, toUserId: z.string().min(1).max(200), toName: z.string().min(1).max(200),
  status: z.enum(["pending", "accepted"]), expiresAt: z.number().int().nonnegative(),
}).strict();
const runFields = { profile, taskId: id, runId: id, createdAt: z.string().min(1).max(128), handoffId: id };
const identity = { profile, taskId: id, createdAt: z.string().min(1).max(128) };
const checkout = z.object({ cwd: z.string().min(1).max(4096), branch: z.string().min(1).max(255) }).strict();
const jiraKey = z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/);
const operation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("profile") }).strict(),
  z.object({ operation: z.literal("pull-requests"), profile }).strict(),
  z.object({ operation: z.literal("calendar-week"), profile }).strict(),
  z.object({ operation: z.literal("quiet-hours"), profile, destination: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), now: z.string().datetime({ offset: true }) }).strict(),
  z.object({ operation: z.literal("board-snapshot"), profile }).strict(),
  z.object({ operation: z.literal("plugin-needs"), profile }).strict(),
  z.object({ operation: z.literal("workflow-state"), ...identity }).strict(),
  z.object({ operation: z.literal("workflow-note"), ...identity, line: z.string().trim().min(1).max(600).refine((line) => !/[\r\n]/.test(line)) }).strict(),
  z.object({ operation: z.literal("run-usage"), ...identity, runId: id }).strict(),
  z.object({ operation: z.literal("plan-approve"), ...identity, planRunId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/) }).strict(),
  z.object({ operation: z.literal("task-retry"), ...identity, requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/) }).strict(),
  z.object({ operation: z.literal("read"), profile, taskId: id }).strict(),
  z.object({ operation: z.literal("context"), profile, taskId: id }).strict(),
  z.object({ operation: z.literal("questions"), profile, taskId: id }).strict(),
  z.object({ operation: z.literal("answer"), profile, taskId: id, createdAt: z.string().min(1).max(128).optional(), answer: z.string().trim().min(1).max(12_000), expected: z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(12_000), option: z.string().min(1).max(12_000).optional() }).strict() }).strict(),
  z.object({ operation: z.literal("answer-repo"), profile, taskId: id, createdAt: z.string().min(1).max(128), cwd: z.string().trim().min(1).max(1000), requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/), expected: z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(12_000) }).strict() }).strict(),
  z.object({ operation: z.literal("cancel-run"), ...runFields }).strict(),
  z.object({ operation: z.literal("reconcile-run"), ...runFields }).strict(),
  z.object({ operation: z.literal("pickup-create"), profile, handoffId: id, title: z.string().trim().min(1).max(500), repo: z.string().min(1).max(500), checkout, jiraKey: jiraKey.optional() }).strict(),
  z.object({ operation: z.literal("pickup-hold"), ...identity, handoffId: id, checkout, jiraKey: jiraKey.optional() }).strict(),
  z.object({ operation: z.literal("pickup-finish"), ...identity, handoffId: id, checkout, jiraKey: jiraKey.optional() }).strict(),
  z.object({ operation: z.literal("pickup-retire"), ...identity, handoffId: id, checkout, jiraKey: jiraKey.optional() }).strict(),
  z.object({ operation: z.literal("pickup-note"), ...identity, handoffId: id, note: z.string().min(1).max(28_800) }).strict(),
  z.object({ operation: z.literal("handoff-note-read"), ...identity, handoffId: id }).strict(),
  z.object({ operation: z.literal("handoff-note"), ...identity, handoffId: id, note: z.string().min(1).max(28_800), expected: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
  z.object({ operation: z.literal("git-repos"), profile }).strict(),
  z.object({ operation: z.literal("git-pickup"), profile, repo: z.string().min(1).max(500), branch: z.string().min(1).max(255), handoffId: id }).strict(),
  z.object({ operation: z.literal("git-inspect"), ...identity, cwd: z.string().min(1).max(4096), branch: z.string().min(1).max(255) }).strict(),
  z.object({ operation: z.literal("git-push"), ...identity, handoffId: id, review: z.string().regex(/^[a-f0-9]{64}$/), recipient: z.string().regex(/^[a-zA-Z0-9_. -]{1,200}$/), commitWip: z.boolean() }).strict(),
  z.object({ operation: z.literal("jira-connected"), profile }).strict(),
  z.object({ operation: z.literal("jira-assign-self"), ...identity, handoffId: id, jiraKey }).strict(),
  z.object({
    operation: z.literal("handoff"), profile, taskId: id, handoff: handoff.nullable(),
    expected: z.object({ handoffId: id.nullable(), createdAt: z.string().min(1).max(128), text: z.string().max(12_000).optional(), review: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  }).strict(),
]);

export type RuntimeServiceTaskGrant = z.infer<typeof operation>["operation"];

function taskDirectory(root: string, requested: string): string {
  const profiles = listTaskProfiles(root);
  const active = resolveActiveProfileId(root) ?? "legacy";
  if (requested !== active && !profiles.includes(requested)) throw new Error("Unknown task profile");
  const directory = profiles.length ? path.join(root, requested) : root;
  assertSafePath(root, directory);
  return directory;
}

export async function runtimeServiceTaskOperation(grants: readonly RuntimeServiceTaskGrant[], input: unknown, authorised: () => boolean = () => true, git = new RuntimeServiceGit()): Promise<unknown> {
  const request = operation.parse(input);
  if (!grants.includes(request.operation)) throw new Error("Service task operation was not reviewed");
  if (!authorised()) throw new Error("Service is not authorised");
  const configuredRoot = getTasksDir();
  const root = fs.existsSync(configuredRoot) ? fs.realpathSync(configuredRoot) : path.resolve(configuredRoot);
  if (request.operation === "profile") {
    const result: ServiceTaskProfiles = { activeProfile: resolveActiveProfileId(root) ?? "legacy", profiles: listTaskProfiles(root) };
    if (!authorised()) throw new Error("Service is not authorised");
    return result;
  }
  const directory = taskDirectory(root, request.profile);
  const lockDirectory = listTaskProfiles(configuredRoot).length ? path.join(configuredRoot, request.profile) : configuredRoot;
  const current = () => authorised() && (resolveActiveProfileId(root) ?? "legacy") === request.profile;
  if (request.operation === "board-snapshot") return serviceBoardSnapshot(configuredRoot, directory, authorised, request.profile, grants.includes("run-usage") ? current : undefined);
  if (request.operation === "plugin-needs") return servicePluginNeeds(authorised);
  if (request.operation === "plan-approve" || request.operation === "task-retry") return serviceTaskDispatch(request, configuredRoot, directory, current);
  if (request.operation === "workflow-state" || request.operation === "workflow-note") return serviceWorkflowOperation(request, directory, lockDirectory, current);
  if (request.operation === "pull-requests" || request.operation === "calendar-week" || request.operation === "quiet-hours") {
    const { serviceSurfaceRead } = await import("./runtime-service-surface-reads");
    return serviceSurfaceRead(request, current);
  }
  if (request.operation === "git-repos" || request.operation === "git-pickup") {
    if (!current()) throw new Error("The active task profile or service authorisation changed");
    return git.operation(request, null, directory, current);
  }
  if (request.operation === "answer-repo") {
    return answerServiceRepoQuestion(request, directory, lockDirectory, () => authorised() && (resolveActiveProfileId(root) ?? "legacy") === request.profile);
  }
  if (request.operation === "git-inspect" || request.operation === "git-push" || request.operation === "jira-assign-self") {
    let checkedTask: string | undefined;
    const readCurrent = () => {
      assertSafePath(directory, path.join(directory, "items", request.taskId + ".json"));
      invalidateTaskCache(directory);
      const latest = findTask(directory, request.taskId);
      if (latest) assertSafePath(directory, path.join(directory, "items", latest.id + ".json"));
      return latest;
    };
    const valid = () => {
      if (!current()) return false;
      const latest = readCurrent();
      if (!latest || latest.id !== request.taskId || latest.createdAt !== request.createdAt || !isTaskOpen(latest)) return false;
      if (request.operation === "git-inspect") return !isTaskOwnershipBlocked(latest) && (checkedTask === undefined || checkedTask === JSON.stringify(latest));
      if (request.operation === "git-push") return latest.handoff?.handoffId === request.handoffId && latest.handoff.status === "pending" && latest.handoff.toName === request.recipient && (checkedTask === undefined || checkedTask === JSON.stringify(latest));
      return latest.teamPickup?.handoffId === request.handoffId && latest.teamPickup.status === "pending" && latest.jiraKey === request.jiraKey;
    };
    const task = await withTaskLock(lockDirectory, () => { if (!valid()) throw new Error("The task or service authorisation changed"); return readCurrent(); });
    if (request.operation === "git-inspect" || request.operation === "git-push") checkedTask = JSON.stringify(task);
    if (request.operation === "jira-assign-self") return serviceJiraOperation(request, task, valid);
    return git.operation(request, task, directory, valid);
  }
  return withTaskLock(lockDirectory, async () => {
    if (!authorised()) throw new Error("Service is not authorised");
    const items = path.join(directory, "items");
    const taskId = request.operation === "pickup-create" ? request.handoffId : request.operation === "jira-connected" ? null : request.taskId;
    if (taskId) assertSafePath(directory, path.join(items, taskId + ".json"));
    if (fs.existsSync(items)) {
      for (const name of fs.readdirSync(items)) {
        if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(items, name));
      }
    }
    invalidateTaskCache(directory);
    let task = taskId ? findTask(directory, taskId) : null;
    if (task) assertSafePath(directory, path.join(items, task.id + ".json"));
    if (request.operation === "pickup-create" || request.operation === "pickup-hold" || request.operation === "pickup-finish" || request.operation === "pickup-retire" || request.operation === "pickup-note" || request.operation === "handoff-note" || request.operation === "handoff-note-read") {
      if (!current()) throw new Error("The active task profile or service authorisation changed");
      return servicePickupOperation(request, task, directory, current);
    }
    if (request.operation === "jira-connected") return serviceJiraOperation(request, task, current);
    if (request.operation === "run-usage") {
      if (!current()) throw new Error("The active task profile or service authorisation changed");
      if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt || isTaskOwnershipBlocked(task)) throw new Error("Task is no longer available");
      return serviceRunUsage(task, directory, request.profile, request.runId, current);
    }
    if (request.operation === "read") return task;
    if (request.operation === "questions") return readServiceQuestions(task, directory);
    if (request.operation === "answer") {
      if ((resolveActiveProfileId(root) ?? "legacy") !== request.profile) throw new Error("The active task profile changed");
      if (request.createdAt !== undefined && task?.createdAt !== request.createdAt) throw new Error("The task changed");
      return answerServiceQuestion(task, directory, request.expected, request.answer, () => authorised() && (resolveActiveProfileId(root) ?? "legacy") === request.profile);
    }
    if (request.operation === "cancel-run" || request.operation === "reconcile-run") {
      if ((resolveActiveProfileId(root) ?? "legacy") !== request.profile) throw new Error("The active task profile changed");
      return serviceTaskRunOperation(task, directory, request, () => authorised() && (resolveActiveProfileId(root) ?? "legacy") === request.profile);
    }
    if (request.operation === "context") {
      if (!task) throw new Error("Task is unavailable");
      const context = await runtimeServiceTaskContext(task, directory, request.profile);
      if (!authorised()) throw new Error("Service is not authorised");
      return context;
    }
    if ((resolveActiveProfileId(root) ?? "legacy") !== request.profile) throw new Error("The active task profile changed");
    if (!task || task.createdAt !== request.expected.createdAt
      || (task.handoff?.handoffId ?? null) !== request.expected.handoffId) return false;
    if (request.expected.handoffId === null && (!request.handoff || request.handoff.status !== "pending" || request.expected.text === undefined || request.expected.text !== task.text || !isTaskOpen(task) || isTaskOwnershipBlocked(task))) return false;
    if (request.expected.handoffId === null && grants.includes("context")) {
      if (!request.expected.review || (await runtimeServiceTaskContext(task, directory, request.profile)).review !== request.expected.review) return false;
      if (!authorised()) throw new Error("Service is not authorised");
      if ((resolveActiveProfileId(root) ?? "legacy") !== request.profile) throw new Error("The active task profile changed");
      invalidateTaskCache(directory);
      const current = findTask(directory, request.taskId);
      if (!current || JSON.stringify(current) !== JSON.stringify(task)) return false;
      task = current;
    }
    if (request.expected.handoffId !== null) {
      if (!task.handoff || task.handoff.status !== "pending") return false;
      if (request.handoff && (request.handoff.handoffId !== task.handoff.handoffId
        || request.handoff.toUserId !== task.handoff.toUserId || request.handoff.toName !== task.handoff.toName
        || request.handoff.expiresAt !== task.handoff.expiresAt || request.handoff.status !== "accepted")) return false;
    }
    if (!authorised() || (resolveActiveProfileId(root) ?? "legacy") !== request.profile) throw new Error("Service authorisation or active task profile changed");
    writeItem(directory, { ...task, handoff: request.handoff ?? undefined });
    if (directory !== lockDirectory) invalidateTaskCache(lockDirectory);
    return true;
  });
}

interface ServiceTasksHost {
  environment: string;
  close: () => Promise<void>;
}

export async function startRuntimeServiceTasks(grants: readonly RuntimeServiceTaskGrant[], current: () => boolean): Promise<ServiceTasksHost> {
  const token = crypto.randomBytes(32);
  const sockets = new Set<net.Socket>();
  const git = new RuntimeServiceGit();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(180_000, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let pending = Buffer.alloc(0);
    let received = false;
    socket.on("data", (chunk: Buffer) => {
      if (received) return socket.destroy();
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 192 * 1024) return socket.destroy();
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      received = true;
      void (async () => {
        let response = { ok: false } as { ok: boolean; result?: unknown };
        try {
          if (newline !== pending.length - 1) throw new Error("Invalid service request");
          const request: unknown = JSON.parse(pending.subarray(0, newline).toString("utf8"));
          if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid service request");
          const record = request as Record<string, unknown>;
          const authorised = () => !socket.destroyed && current();
          if (Object.keys(record).sort().join(",") !== "request,token" || typeof record.token !== "string" || !/^[a-f0-9]{64}$/.test(record.token)
            || !crypto.timingSafeEqual(Buffer.from(record.token, "hex"), token) || !authorised()) throw new Error("Service is not authorised");
          const result = await runtimeServiceTaskOperation(grants, record.request, authorised, git);
          if (!authorised()) throw new Error("Service is not authorised");
          response = { ok: true, result };
          if (Buffer.byteLength(JSON.stringify(response)) >= 2 * 1024 * 1024) response = { ok: false };
        } catch { response = { ok: false }; }
        if (!socket.destroyed) socket.end(JSON.stringify(response) + "\n");
      })();
    });
  });
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  server.on("error", () => { for (const socket of sockets) socket.destroy(); server.close(); });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Service task access is unavailable"); }
  return {
    environment: JSON.stringify({ port: address.port, token: token.toString("hex") }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
