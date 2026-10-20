import { createHash } from "node:crypto";
import { StoryboardError } from "@/lib/storyboard/errors";
import { decideOrchestrationPlan } from "@/lib/storyboard/orchestrator";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { inlinePlainText } from "@shared/task-note/sections.ts";
import { withSlackProfile } from "./answers";
import { runCheapModel } from "./cheap-model";

/** What a task is doing right now, read fresh (never from the cached Slack item). */
export type SlackTaskReplyState =
  | { kind: "plan-ready"; planRunId: string }
  | { kind: "running" }
  | { kind: "idle" };

export interface SlackTaskReplyDependencies {
  state: (profile: string, taskId: string) => SlackTaskReplyState;
  /** The Revise button's server path: decideOrchestrationPlan with decision "revise". Throws a StoryboardError when the plan moved on. */
  revisePlan: (profile: string, taskId: string, planRunId: string, guidance: string, requestId: string) => Promise<void>;
  saveNote: (profile: string, taskId: string, line: string) => void;
  /** Answer a question about the task from its note on the cheap tier. Null when there is no answer to give (no cheap tier, or the call failed). */
  answerQuestion?: (profile: string, taskId: string, question: string, label: string) => Promise<string | null>;
}

export interface SlackTaskReply {
  profile: string;
  taskId: string;
  /** Shown in the confirmation. Falls back to the task id. */
  label: string;
  text: string;
  /** The Slack event id: the same message never revises a plan twice. */
  eventId: string;
}

/** The note's log entries are single lines of at most 600 characters. */
const NOTE_LINE_MAX = 600;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function readSlackTaskReplyState(profile: string, taskId: string): SlackTaskReplyState {
  const record = withSlackProfile(profile, () => readOrchestration(taskId));
  if (!record || record.terminal) return { kind: "idle" };
  const auto = record.auto;
  if (record.status === "needs-you" && auto?.phase === "plan" && auto.waiting?.kind === "plan-approval") {
    // Same pick as the summary the Revise button reads: the latest plan run of the current attempt.
    const run = auto.runs.filter((entry) => entry.phase === "plan" && entry.attempt === auto.attempt).at(-1);
    if (run) return { kind: "plan-ready", planRunId: run.runId };
  }
  return record.status === "starting" || record.status === "running" ? { kind: "running" } : { kind: "idle" };
}

export const defaultSlackTaskReplyDependencies: SlackTaskReplyDependencies = {
  state: readSlackTaskReplyState,
  revisePlan: (profile, taskId, planRunId, guidance, requestId) => withSlackProfile(profile, async () => {
    const record = readOrchestration(taskId);
    if (!record) throw new StoryboardError("That task is not on auto.", 404);
    const result = await decideOrchestrationPlan({
      action: "plan-decision", taskId, planRunId, decision: "revise", guidance,
      idempotencyKey: `slack-${createHash("sha256").update(requestId).digest("hex").slice(0, 40)}`,
    });
    // Same as the API route's after(): start the revised plan run without holding the Slack queue.
    if (result.execute) void Promise.resolve().then(result.execute).catch((error) => console.error("[slack] revised plan run failed to start", error));
  }),
  saveNote: (profile, taskId, line) => withSlackProfile(profile, () => { updateTaskNoteSections({ taskId }, { op: "append_log", message: line }); }),
  answerQuestion: async (profile, taskId, question, label) => {
    const context = withSlackProfile(profile, () => {
      const view = updateTaskNoteSections({ taskId }, { op: "read" }).view;
      return [
        `Task: ${label}`,
        view.summary.length ? `Summary: ${view.summary.map(inlinePlainText).join(" ")}` : "",
        view.statusUpdate ? `Current state: ${view.statusUpdate.currentState}\nNext step: ${view.statusUpdate.nextStep}` : "",
        ...view.questions.map((item) => `Question: ${item.text}${item.resolved ? `\nJohn's answer: ${item.answer ?? "(marked answered, no text)"}` : "\n(still open)"}`),
        ...view.decisions.map((item) => `Decision: ${item.title} ${inlinePlainText(item.body)}`),
      ].filter(Boolean).join("\n\n").slice(0, 8000);
    });
    const result = await runCheapModel({
      system: "You answer John's quick question about one of his tasks, in Slack. Use only the context given. Be brief and plain: one to three sentences. Quote his own earlier answers exactly when asked about them. If the context doesn't say, say so; never guess.",
      prompt: `Context:\n${context}\n\nJohn asks: ${question}`,
      maxOutputTokens: 400,
    });
    return result.ok && result.text.trim() ? result.text.trim() : null;
  },
};

/** A question to answer, as opposed to a note or feedback to keep. Statements and requests are never taken for one. */
export function looksLikeQuestion(text: string): boolean {
  const flat = text.trim();
  if (!flat || flat.length > 300) return false;
  return /\?\s*$/.test(flat) || /^(?:what|why|how|when|where|who|which|did|does|do|is|are|was|were)\b/i.test(flat);
}

/** "approve", "lgtm", "go ahead": approval is its own decision, never revision feedback. */
const APPROVAL = /^(?:approved?|approve (?:it|the plan|plan)|lgtm|looks good(?: to me)?|ship it|go(?: ahead)?|go for it|yes,? (?:approve|go)(?: ahead)?|sounds good,? go)[.!\s]*$/i;

export function isPlanApproval(text: string): boolean {
  return APPROVAL.test(text.trim());
}

function saveFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Couldn't save the note.";
}

/**
 * A reply from the task's owner in the task's Slack thread, routed by what the task is doing now.
 * Always returns the line to post back: nothing here falls through to generic chat.
 */
export async function replyToTaskThread(deps: SlackTaskReplyDependencies, reply: SlackTaskReply): Promise<string> {
  const { profile, taskId, label } = reply;
  const text = reply.text.trim();
  const state = deps.state(profile, taskId);

  if (state.kind === "plan-ready" && isPlanApproval(text)) {
    return `Nothing changed. To approve the plan for ${label}, use Approve plan on the Plan ready card or in DevHub; replies here are treated as revision feedback.`;
  }

  if (state.kind === "plan-ready") {
    let noteSaved = true;
    // The note first, so the revised plan run can read the feedback.
    try { deps.saveNote(profile, taskId, oneLine(`Plan feedback (Slack): ${text}`, NOTE_LINE_MAX)); } catch { noteSaved = false; }
    const saved = noteSaved ? " Saved to the task note." : " I couldn't save it to the task note.";
    try {
      await deps.revisePlan(profile, taskId, state.planRunId, text.slice(0, 4000), reply.eventId);
      return `📝 Sent back for a revised plan with your feedback.${saved}`;
    } catch (error) {
      if (error instanceof StoryboardError && (error.status === 409 || error.status === 404)) return `⚠️ I couldn't send the plan back: ${error.message}${saved} Open DevHub to check the task.`;
      return `⚠️ I couldn't confirm the plan went back for revision.${saved} Check the task in DevHub before replying again.`;
    }
  }

  // A question gets an answer, not a log line in the note.
  if (deps.answerQuestion && looksLikeQuestion(text)) {
    try {
      const answer = await deps.answerQuestion(profile, taskId, text, label);
      if (answer) return answer;
    } catch { /* fall through to the line below */ }
    return `I couldn't answer that just now. Ask again in a moment, or open ${label} in DevHub.`;
  }

  try {
    deps.saveNote(profile, taskId, oneLine(`Slack: ${text}`, NOTE_LINE_MAX));
  } catch (error) {
    return `⚠️ Couldn't save that to the task note for ${label}: ${saveFailure(error)}`;
  }
  return state.kind === "running"
    ? `📝 Saved to the task note for ${label}. The agent is running; I haven't interrupted it.`
    : `📝 Saved to the task note for ${label}.`;
}
