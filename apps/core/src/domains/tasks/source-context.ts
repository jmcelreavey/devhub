import fs from "node:fs";
import { splitTaskNote } from "../../../../../packages/shared/task-note/sections.ts";
import path from "node:path";
import { createHash } from "node:crypto";
import { getActiveTasksDir, getNotesDir } from "../../lib/notes/dir";
import { getJiraSourceContext, type JiraSourceContext } from "../../lib/jira/client";
import { writeAtomicNow } from "../../lib/atomic-write";
import { withPluginMutationLock } from "../../lib/plugins/lock";
import { currentTaskNode, loadTaskIndex } from "./task-index";
import { resolveTaskNotePath } from "./task-notes";
import { activeTaskProfile } from "./profile-request";

export interface SourceContextSnapshot {
  version: 1;
  revision: string;
  refreshedAt: string;
  source: JiraSourceContext;
  reviewed?: { sourceRevision: string; briefRevision: string; at: string };
}
export interface SourceContextView {
  snapshot: SourceContextSnapshot | null;
  briefRevision: string;
  stale: boolean;
}

export class SourceContextConflict extends Error {}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function contextFile(taskId: string): string {
  if (!/^[\w-]{1,200}$/.test(taskId)) throw new Error("Invalid task ID.");
  return path.join(getActiveTasksDir(), ".source-context", taskId + ".json");
}
function briefRevision(taskId: string): string {
  const node = currentTaskNode(loadTaskIndex(), taskId);
  if (!node) throw new Error("Task not found.");
  const notePath = resolveTaskNotePath(node.task, node.date);
  if (notePath.includes("..") || path.isAbsolute(notePath)) throw new Error("Invalid task note path.");
  let body = "";
  try { body = fs.readFileSync(path.join(getNotesDir(), notePath + ".json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const blocks: unknown = body ? JSON.parse(body) : [];
  if (!Array.isArray(blocks)) throw new Error("Couldn’t read the task brief.");
  const split = splitTaskNote(blocks);
  return hash(JSON.stringify({ text: node.task.text, links: node.task.links, jiraKey: node.task.jiraKey,
    brief: [...split.freeform, ...(split.sections.userNotes ?? [])].map(({ type, content, props, children }) => ({ type, content, props, children })) }));
}

export function readSourceContext(taskId: string): SourceContextView {
  let snapshot: SourceContextSnapshot | null = null;
  try { snapshot = JSON.parse(fs.readFileSync(contextFile(taskId), "utf8")) as SourceContextSnapshot; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const revision = briefRevision(taskId);
  return { snapshot, briefRevision: revision, stale: !!snapshot &&
    (snapshot.reviewed?.sourceRevision !== snapshot.revision || snapshot.reviewed?.briefRevision !== revision) };
}

export function readSourceContextIfPresent(taskId: string): SourceContextView | null {
  return fs.existsSync(contextFile(taskId)) ? readSourceContext(taskId) : null;
}

export async function refreshSourceContext(taskId: string, expectedRevision: string | null): Promise<SourceContextView> {
  const node = currentTaskNode(loadTaskIndex(), taskId);
  if (!node) throw new Error("Task not found.");
  const key = node.task.jiraKey ?? node.task.links?.find((link) => link.kind === "jira")?.id;
  if (!key) throw new Error("Link a Jira ticket to refresh source context.");
  const profile = activeTaskProfile();
  const source = await getJiraSourceContext(key);
  const file = contextFile(taskId);
  return withPluginMutationLock(path.dirname(file), async () => {
    const current = readSourceContext(taskId);
    if ((current.snapshot?.revision ?? null) !== expectedRevision) throw new SourceContextConflict("Context changed while Jira was loading. Refresh and review the newer version.");
    if (activeTaskProfile() !== profile) throw new SourceContextConflict("The active task profile changed. Refresh before continuing.");
    const latest = currentTaskNode(loadTaskIndex(), taskId);
    const latestKey = latest?.task.jiraKey ?? latest?.task.links?.find((link) => link.kind === "jira")?.id;
    if (latestKey !== key) throw new SourceContextConflict("The linked Jira ticket changed. Refresh before continuing.");
    const snapshot: SourceContextSnapshot = {
      version: 1, revision: hash(JSON.stringify(source)), refreshedAt: new Date().toISOString(), source,
      ...(current.snapshot?.reviewed ? { reviewed: current.snapshot.reviewed } : {}),
    };
    writeAtomicNow(file, JSON.stringify(snapshot));
    return readSourceContext(taskId);
  });
}

export async function acknowledgeSourceContext(taskId: string, expectedRevision: string, expectedBriefRevision: string): Promise<SourceContextView> {
  const file = contextFile(taskId);
  const profile = activeTaskProfile();
  return withPluginMutationLock(path.dirname(file), async () => {
    if (activeTaskProfile() !== profile) throw new SourceContextConflict("The active task profile changed. Refresh before continuing.");
    const current = readSourceContext(taskId);
    if (!current.snapshot || current.snapshot.revision !== expectedRevision || current.briefRevision !== expectedBriefRevision) {
      throw new SourceContextConflict("The source or brief changed. Read the latest context before using it.");
    }
    writeAtomicNow(file, JSON.stringify({
      ...current.snapshot, reviewed: { sourceRevision: expectedRevision, briefRevision: expectedBriefRevision, at: new Date().toISOString() },
    }));
    return readSourceContext(taskId);
  });
}
