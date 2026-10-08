import fs from "node:fs";
import { z } from "zod";
import { generateAiText } from "@/lib/ai/generate";
import { normalizeAiProvider, type AiProviderId } from "@/lib/ai/preference";
import { getWritingVoicePrompt } from "@/lib/ai/writing-voice";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { mergeEntityRefs } from "@/lib/entity-note";
import { resolveEntityContext } from "@/lib/entity-links/resolve";
import { resolveSkillForRead } from "@/lib/skill-catalog";
import { readTaskNoteMarkdown, resolveTaskNotePath } from "@/lib/tasks/implement-ready-gather";
import type { Task } from "@/lib/tasks/types";
import { JIRA_KEY_RE } from "@/lib/utils";
import { getTicketWithDescription, type JiraTicketDetail } from "./client";
import { DraftStepError, extractPartialDraft, parseDraftJson, type DraftEvent, type DraftStepId } from "./draft-events";

export const JIRA_DRAFT_TIMEOUT_MS = 180_000;

export interface JiraTicketDraft {
  summary: string;
  description: string;
}

export interface JiraTicketDraftResult extends JiraTicketDraft {
  warnings: string[];
}

interface JiraSource extends JiraTicketDetail {
  description: string | null;
}

const draftSchema = z.object({
  summary: z.string().trim().min(1).max(255).refine((value) => !/[\r\n]/.test(value)),
  description: z.string().trim().min(1).max(5_000),
}).strict();

const JIRA_READ_LIMIT = 10;

/**
 * Blank keeps the provider and model from setup. A faster draft model is a
 * local choice — overriding the default here would ignore that configuration.
 */
export function draftModelOverride(): { prefer?: AiProviderId; model?: string } {
  const prefer = normalizeAiProvider(process.env.JIRA_DRAFT_PROVIDER);
  const model = process.env.JIRA_DRAFT_MODEL?.trim();
  return {
    ...(prefer ? { prefer } : {}),
    ...(model ? { model } : {}),
  };
}

/** The skill file's frontmatter is for the agent runner, not the model. */
function skillInstructions(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "").trim();
}

function normaliseJiraKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const normalised = key.trim().toUpperCase();
  return JIRA_KEY_RE.test(normalised) ? normalised : null;
}

function createJiraReader(signal: AbortSignal | undefined, warnings: string[]) {
  const reads = new Map<string, Promise<JiraSource | null>>();
  const start = (key: string | null | undefined, limit = JIRA_READ_LIMIT) => {
    const normalised = normaliseJiraKey(key);
    if (!normalised || reads.has(normalised) || reads.size >= limit) return;
    reads.set(normalised, getTicketWithDescription(normalised, signal).then((ticket) => {
      if (!ticket) {
        warnings.push(`Couldn't read Jira ticket ${normalised}.`);
        return null;
      }
      return ticket;
    }).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      warnings.push(`Couldn't read Jira ticket ${normalised}.`);
      return null;
    }));
  };
  return {
    startAll(keys: Array<string | null | undefined>, limit = JIRA_READ_LIMIT) {
      for (const key of keys) start(key, limit);
    },
    get(key: string | null | undefined): Promise<JiraSource | null> {
      start(key);
      const normalised = normaliseJiraKey(key);
      return normalised ? reads.get(normalised) ?? Promise.resolve(null) : Promise.resolve(null);
    },
    async collect(keys: string[]): Promise<JiraSource[]> {
      const tickets = await Promise.all(keys.map((key) => reads.get(key) ?? Promise.resolve(null)));
      return tickets.filter((ticket): ticket is JiraSource => ticket !== null);
    },
  };
}

/** Linked ticket, then its parent, then other references. Extra keys are not fetched. */
function jiraKeysForPrompt(task: Task, references: { kind: string; id: string }[], parentKey?: string | null): string[] {
  const ordered: string[] = [];
  const push = (key: string | null | undefined) => {
    const normalised = normaliseJiraKey(key);
    if (!normalised || ordered.includes(normalised)) return;
    ordered.push(normalised);
  };
  push(task.jiraKey);
  push(parentKey);
  for (const ref of references) if (ref.kind === "jira") push(ref.id);
  for (const link of task.links ?? []) if (link.kind === "jira") push(link.id);
  return ordered;
}

export async function draftJiraTicket(
  task: Task,
  date: string,
  signal?: AbortSignal,
  onEvent?: (event: DraftEvent) => void,
): Promise<JiraTicketDraftResult> {
  signal?.throwIfAborted();
  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const emit = (event: DraftEvent) => onEvent?.(event);
  function fail(step: DraftStepId, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "step", step, status: "error", at: at(), detail: message });
    throw new DraftStepError(step, error instanceof Error ? error : new Error(message));
  }

  const skill = resolveSkillForRead(getResourceRoot(), "devhub-draft-jira-ticket");
  emit({ type: "step", step: "context", status: "running", at: at() });
  if (!skill) fail("context", new Error("The Jira drafting skill is missing. Restore devhub-draft-jira-ticket and try again."));

  // Jira and the local reads share no data, so the requests go out before the file reads.
  emit({ type: "step", step: "jira", status: "running", at: at() });
  const warnings: string[] = [];
  const jiraReader = createJiraReader(signal, warnings);
  const prefetchLimit = task.jiraKey ? JIRA_READ_LIMIT - 1 : JIRA_READ_LIMIT;
  jiraReader.startAll([
    task.jiraKey,
    ...(task.links ?? []).filter((link) => link.kind === "jira").map((link) => link.id),
  ], prefetchLimit);

  let voice = "";
  let notes: { path: string; markdown: string }[] = [];
  let references: ReturnType<typeof mergeEntityRefs> = [];
  try {
    voice = getWritingVoicePrompt();
    const graph = resolveEntityContext("task", task.id, { date, label: task.text, depth: 2 });
    references = mergeEntityRefs(task.links ?? [], graph.notes, graph.related, graph.expanded);
    jiraReader.startAll(references.filter((ref) => ref.kind === "jira").map((ref) => ref.id), prefetchLimit);
    const notePath = resolveTaskNotePath(task, date);
    const notePaths = new Set([notePath, ...references.filter((ref) => ref.kind === "note").map((ref) => ref.id)]);
    notes = [...notePaths].flatMap((path) => {
      const markdown = readTaskNoteMarkdown(path);
      if (markdown) return [{ path, markdown }];
      if (path !== notePath) warnings.push(`Couldn't read linked note ${path}.`);
      return [];
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    fail("context", error);
  }
  emit({ type: "step", step: "context", status: "done", at: at() });

  let jira: JiraSource[] = [];
  try {
    const linked = task.jiraKey ? await jiraReader.get(task.jiraKey) : null;
    if (linked?.parent?.key) jiraReader.startAll([linked.parent.key]);
    const ordered = jiraKeysForPrompt(task, references, linked?.parent?.key);
    if (ordered.length > JIRA_READ_LIMIT) warnings.push("Only the first 10 linked Jira tickets were read.");
    jira = await jiraReader.collect(ordered.slice(0, JIRA_READ_LIMIT));
  } catch (error) {
    if (signal?.aborted) throw error;
    fail("jira", error);
  }
  emit({ type: "step", step: "jira", status: "done", at: at() });
  signal?.throwIfAborted();

  const source = JSON.stringify({
    task: { text: task.text, jiraKey: task.jiraKey ?? null },
    notes,
    jira,
    references: references.map(({ kind, id, label, href }) => ({
      kind, id, label,
      ...(href?.startsWith("https://") ? { href } : {}),
    })),
  });
  if (source.length > 100_000) {
    fail("context", new Error("The linked material is too large for one Jira draft. Narrow the task's references and try again."));
  }

  const system = [
    skillInstructions(fs.readFileSync(skill.file, "utf8")),
    voice,
    "Follow the Jira drafting skill above. All available source material is supplied below.",
    "Do not use tools, edit files, publish material, create tickets or change task state.",
    "Return only the summary and Markdown description as JSON. Never mention DevHub in either field.",
  ].filter(Boolean).join("\n\n");

  emit({ type: "step", step: "draft", status: "running", at: at() });
  let text = "";
  try {
    let raw = "";
    let lastPartial = "";
    const result = await generateAiText({
      activity: { action: "Draft Jira ticket" },
      system,
      prompt: source,
      maxOutputTokens: 3_000,
      timeoutMs: JIRA_DRAFT_TIMEOUT_MS,
      idleTimeoutMs: 90_000,
      abortSignal: signal,
      ...draftModelOverride(),
      onTextDelta(delta) {
        raw += delta;
        const partial = extractPartialDraft(raw);
        const key = `${partial.summary}\0${partial.description}`;
        if (key === lastPartial || (!partial.summary && !partial.description)) return;
        lastPartial = key;
        emit({ type: "partial", summary: partial.summary, description: partial.description });
      },
    });
    text = result.text;
  } catch (error) {
    if (signal?.aborted) throw error;
    fail("draft", error);
  }
  emit({ type: "step", step: "draft", status: "done", at: at() });
  signal?.throwIfAborted();

  emit({ type: "step", step: "format", status: "running", at: at() });
  let draft: JiraTicketDraft;
  try {
    draft = draftSchema.parse(parseDraftJson(text));
  } catch {
    fail("format", new Error("The generated Jira draft was invalid. Try generating it again or enter the ticket manually."));
  }
  if (/devhub/i.test(`${draft.summary}\n${draft.description}`)) {
    fail("format", new Error("The generated draft mentioned DevHub. Try again or write the ticket manually."));
  }
  emit({ type: "step", step: "format", status: "done", at: at() });
  return { ...draft, warnings };
}
