import fs from "node:fs";
import { z } from "zod";
import { generateAiText } from "@/lib/ai/generate";
import { getWritingVoicePrompt } from "@/lib/ai/writing-voice";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { mergeEntityRefs } from "@/lib/entity-note";
import { resolveEntityContext } from "@/lib/entity-links/resolve";
import { resolveSkillForRead } from "@/lib/skill-catalog";
import { fetchJiraDescriptionText, readTaskNoteMarkdown, resolveTaskNotePath } from "@/lib/tasks/implement-ready-gather";
import type { Task } from "@/lib/tasks/types";
import { JIRA_KEY_RE } from "@/lib/utils";
import { getTicket, type JiraTicketDetail } from "./client";

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

export async function draftJiraTicket(task: Task, date: string, signal?: AbortSignal): Promise<JiraTicketDraftResult> {
  signal?.throwIfAborted();
  const skill = resolveSkillForRead(getResourceRoot(), "devhub-draft-jira-ticket");
  if (!skill) throw new Error("The Jira drafting skill is missing. Restore devhub-draft-jira-ticket and try again.");

  const graph = resolveEntityContext("task", task.id, { date, label: task.text, depth: 2 });
  const references = mergeEntityRefs(task.links ?? [], graph.notes, graph.related, graph.expanded);
  const notePath = resolveTaskNotePath(task, date);
  const notePaths = new Set([notePath, ...references.filter((ref) => ref.kind === "note").map((ref) => ref.id)]);
  const warnings: string[] = [];
  const notes = [...notePaths].flatMap((path) => {
    const markdown = readTaskNoteMarkdown(path);
    if (markdown) return [{ path, markdown }];
    if (path !== notePath) warnings.push(`Couldn't read linked note ${path}.`);
    return [];
  });

  const jiraReads = new Map<string, Promise<JiraSource | null>>();
  function readJira(key: string): Promise<JiraSource | null> {
    const existing = jiraReads.get(key);
    if (existing) return existing;
    const read = Promise.all([
      getTicket(key, signal),
      fetchJiraDescriptionText(key, signal),
    ]).then(([ticket, description]) => {
      if (!ticket) {
        warnings.push(`Couldn't read Jira ticket ${key}.`);
        return null;
      }
      return { ...ticket, description };
    }).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      warnings.push(`Couldn't read Jira ticket ${key}.`);
      return null;
    });
    jiraReads.set(key, read);
    return read;
  }

  const linked = task.jiraKey ? await readJira(task.jiraKey) : null;
  const jiraKeys = [...new Set([
    ...(task.jiraKey ? [task.jiraKey] : []),
    ...(linked?.parent ? [linked.parent.key] : []),
    ...references.filter((ref) => ref.kind === "jira").map((ref) => ref.id.toUpperCase()),
  ])].filter((key) => JIRA_KEY_RE.test(key));
  if (jiraKeys.length > 10) warnings.push("Only the first 10 linked Jira tickets were read.");
  const jira = (await Promise.all(jiraKeys.slice(0, 10).map(readJira))).filter((ticket) => ticket !== null);
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
    throw new Error("The linked material is too large for one Jira draft. Narrow the task's references and try again.");
  }

  const result = await generateAiText({
    activity: { action: "Draft Jira ticket" },
    system: [
      fs.readFileSync(skill.file, "utf8"),
      getWritingVoicePrompt(),
      "Follow the Jira drafting skill above. All available source material is supplied below.",
      "Do not use tools, edit files, publish material, create tickets or change task state.",
      "Return only the summary and Markdown description as JSON. Never mention DevHub in either field.",
    ].filter(Boolean).join("\n\n"),
    prompt: source,
    maxOutputTokens: 3_000,
    timeoutMs: JIRA_DRAFT_TIMEOUT_MS,
    idleTimeoutMs: 90_000,
    abortSignal: signal,
  });
  signal?.throwIfAborted();

  let draft: JiraTicketDraft;
  try {
    const json = result.text.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
    draft = draftSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("The generated Jira draft was invalid. Try generating it again or enter the ticket manually.");
  }
  if (/devhub/i.test(`${draft.summary}\n${draft.description}`)) {
    throw new Error("The generated draft mentioned DevHub. Try again or write the ticket manually.");
  }
  return { ...draft, warnings };
}
