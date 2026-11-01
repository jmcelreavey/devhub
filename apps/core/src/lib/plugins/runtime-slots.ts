import { z } from "zod";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { resolveScannedRepo } from "../repos/scanned-repo";
import { activeTaskProfile, withTaskProfileRequest } from "../../domains/tasks/profile-request";
import { currentTaskNode, loadTaskIndex } from "../../domains/tasks/task-index";
import { resolveTaskNotePath } from "../../domains/tasks/task-notes";
import { PluginApiError, type PluginContext } from "./context";
import { invokeRuntime, loadRuntime, runtimeCatalog } from "./runtime-host";
import { runtimeResponse } from "./runtime-response";
import { hashFile } from "./inspect";
import path from "node:path";
import { slotContextSchema, slotRequestSchema, type SlotContext } from "../../../../../packages/shared/ui-lib/plugins/slot-contract";

export function runtimeSlots(ctx: PluginContext, location: SlotContext["location"]) {
  return runtimeCatalog(ctx).flatMap((plugin) => (plugin.runtime.capabilities?.slots ?? [])
    .filter((slot) => slot.location === location).map((slot) => ({ ...slot, plugin: plugin.name, revision: hashFile(path.join(plugin.root, "devhub-plugin.json")) })));
}

/** Ignore client descriptions, paths and ownership flags; resolve them afresh for every call. */
export function resolveSlotContext(input: unknown, write = false) {
  const parsed = slotContextSchema.safeParse(input);
  if (!parsed.success) throw new PluginApiError(400, "SLOT_CONTEXT", "Invalid plugin context.");
  const context = parsed.data;
  if (context.location === "setup") return context;
  if (context.location === "repo") {
    const repoPath = resolveScannedRepo(context.repoName);
    if (!repoPath) throw new PluginApiError(404, "SLOT_REPO", "This repo is no longer available.");
    return { ...context, repoPath };
  }
  if (context.profile !== activeTaskProfile()) throw new PluginApiError(409, "SLOT_PROFILE", "The active task profile changed. Refresh before continuing.");
  return withTaskProfileRequest(context.profile, () => {
    const node = currentTaskNode(loadTaskIndex(), context.taskId);
    if (!node || node.task.createdAt !== context.createdAt) throw new PluginApiError(409, "SLOT_TASK", "This task changed or is no longer available. Refresh before continuing.");
    const task = node.task;
    const readOnly = isTaskOwnershipBlocked(task) || !isTaskOpen(task);
    if (write && readOnly) throw new PluginApiError(409, "SLOT_READ_ONLY", "This task is read-only. Refresh before continuing.");
    return { location: context.location, profile: context.profile, taskId: task.id, createdAt: task.createdAt, title: task.text, notePath: resolveTaskNotePath(task, node.date), readOnly };
  });
}

export async function invokeRuntimeSlot(ctx: PluginContext, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const parsed = slotRequestSchema.safeParse(input);
  if (!parsed.success) throw new PluginApiError(400, "SLOT_REQUEST", "Invalid plugin slot request.");
  const { plugin: name, slot: id, context: requested, action, confirmed } = parsed.data;
  const plugin = loadRuntime(ctx, name);
  if (parsed.data.revision !== hashFile(path.join(plugin.root, "devhub-plugin.json"))) throw new PluginApiError(409, "SLOT_CHANGED", "This plugin changed. Refresh and review the action again.");
  const slot = plugin.runtime.capabilities?.slots?.find((slot) => slot.id === id && slot.location === requested.location);
  if (!slot) throw new PluginApiError(404, "SLOT_MISSING", "This plugin slot is no longer available.");
  const route = action && slot.routes.find((route) => route.path === action.path && route.method === action.method);
  if (action && !route) throw new PluginApiError(404, "SLOT_ACTION", "This action was not reviewed for this slot.");
  const write = !!action && action.method !== "GET";
  if (write && confirmed !== true) throw new PluginApiError(409, "SLOT_CONFIRM", "Confirm this action in DevHub before continuing.");
  const context = resolveSlotContext(requested, write);
  const output = await invokeRuntime(ctx, name, { kind: "slot", path: id, method: action ? "POST" : "GET", body: { context, ...(action ? { action } : {}) } }, signal, undefined, plugin.root);
  if (requested.location === "task" && requested.profile !== activeTaskProfile()) throw new PluginApiError(409, "SLOT_PROFILE", "The active task profile changed. Refresh before continuing; check the action's status before retrying.");
  return runtimeResponse(action ? z.unknown() : z.string().max(1024 * 1024), output, plugin, ctx);
}
