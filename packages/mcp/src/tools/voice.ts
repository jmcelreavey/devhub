import { voiceList, voiceAnswer, voiceTrain, voiceApply } from "../../../../packages/shared/actions/voice.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * My voice: train the `my-voice` skill from the user's own answers to scenarios.
 *
 * Everything the /voice page does has a tool here, so an agent can run the whole
 * loop: see the scenarios, record the user's answers, draft an update, and save
 * it once the user has seen it. Registered under the `workspace` toolset (see
 * server.ts) beside the skill reads, which keeps it out of Cursor's tool budget.
 */

interface Scenario {
  id: string;
  register: string;
  situation: string;
  task: string;
}

interface Answer {
  scenarioId: string;
  answer: string;
  answeredAt: string;
  trainedAt?: string;
}

interface VoiceState {
  scenarios: Scenario[];
  answers: Answer[];
  skill: { found: boolean; readOnly: boolean; learnedModified: number | null };
  aiConfigured: boolean;
}

interface Proposal {
  content: string;
  answers: { scenarioId: string; answeredAt: string }[];
  current: string | null;
}

type DraftState =
  | { status: "idle" }
  | { status: "running"; startedAt: string }
  | { status: "ready"; finishedAt: string; proposal: Proposal }
  | { status: "failed"; finishedAt: string; error: string };

/** Drafting is a minute or two on a CLI provider, which is why it starts and polls rather than blocks. */
const DRAFT_HINT = "A CLI provider takes a minute or two.";

function ago(when: number | string | null): string {
  if (when === null) return "never";
  const ms = typeof when === "number" ? when : Date.parse(when);
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (!Number.isFinite(mins)) return "unknown";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const clip = (s: string, max: number): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export type ListFilter = "unanswered" | "new" | "answered";

export function formatList(state: VoiceState, opts: { filter?: ListFilter; scenarioId?: string } = {}): string {
  const byId = new Map(state.answers.map((a) => [a.scenarioId, a]));
  const known = new Set(state.scenarios.map((s) => s.id));
  const answered = state.scenarios.filter((s) => byId.has(s.id)).length;
  const fresh = state.answers.filter((a) => known.has(a.scenarioId) && !a.trainedAt).length;
  const unanswered = state.scenarios.length - answered;

  const lines = [
    `My voice: ${answered}/${state.scenarios.length} answered · ${fresh} new since the last update · ${
      state.skill.learnedModified === null ? "not trained yet" : `learned-voice.md updated ${ago(state.skill.learnedModified)}`
    }`,
  ];
  if (!state.skill.found) lines.push("The my-voice skill isn't installed, so there is nothing to train.");
  else if (state.skill.readOnly) lines.push("The my-voice skill is read-only here: answers save, but an update can't be written.");
  if (!state.aiConfigured) lines.push("No AI provider is configured: answers save, but voice_train can't draft an update.");

  const shown = state.scenarios.filter((s) => {
    if (opts.scenarioId) return s.id === opts.scenarioId;
    const a = byId.get(s.id);
    if (opts.filter === "unanswered") return !a;
    if (opts.filter === "new") return a !== undefined && !a.trainedAt;
    if (opts.filter === "answered") return a !== undefined;
    return true;
  });

  lines.push("");
  for (const s of shown) {
    const a = byId.get(s.id);
    const status = !a ? "not answered" : a.trainedAt ? "answered, learned" : "answered, new";
    lines.push(`- ${s.id} [${s.register}] ${status} — ${s.situation} → ${s.task}`);
    // The whole answer only when one scenario was asked for: twenty full answers would swamp the list.
    if (a) lines.push(`  Their answer: ${JSON.stringify(opts.scenarioId ? a.answer : clip(a.answer, 160))}`);
  }
  if (shown.length === 0) lines.push("(nothing matches)");

  const next: string[] = [];
  if (unanswered > 0) next.push("Ask the user for their own answer to a scenario, then record it with voice_answer.");
  if (fresh > 0) next.push("voice_train drafts an update from the new answers.");
  if (next.length > 0) lines.push("", ...next);
  return lines.join("\n");
}

export function formatDraft(draft: DraftState): string {
  switch (draft.status) {
    case "idle":
      return "No draft. Start one with voice_train action:start (it needs new answers: see voice_list).";
    case "running":
      return `Drafting, started ${ago(draft.startedAt)}. ${DRAFT_HINT} Check again with voice_train action:status.`;
    case "failed":
      return `The last draft failed: ${draft.error}\nStart again with voice_train action:start.`;
    case "ready":
      return [
        `Draft ready (${draft.proposal.answers.length} answer${draft.proposal.answers.length === 1 ? "" : "s"}, made ${ago(draft.finishedAt)}). Nothing is saved yet.`,
        "Show it to the user: it changes how agents write as them, so they should see it before it goes live.",
        draft.proposal.current === null ? "This is the first round, so there is no earlier learned-voice.md." : "It replaces the current learned-voice.md.",
        "",
        "--- learned-voice.md (proposed) ---",
        draft.proposal.content,
        "--- end ---",
        "",
        "Call voice_apply with confirm:true to save immediately. Pass edited text as content to change the draft.",
      ].join("\n");
  }
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function registerVoiceTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(server, voiceList, { execute: async ({ filter, scenarioId }) =>
      withDashboardErrors(async () => {
        const state = await dashboard.get<VoiceState>("/api/voice");
        if (scenarioId && !state.scenarios.some((s) => s.id === scenarioId)) {
          return text(`No scenario ${scenarioId}. voice_list shows the ids.`, true);
        }
        return text(formatList(state, { filter, scenarioId }));
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, voiceAnswer, { execute: async ({ scenarioId, answer }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.put<{ answers: Answer[] }>("/api/voice", { scenarioId, answer });
        const fresh = r.answers.filter((a) => !a.trainedAt).length;
        const done = answer.trim() ? `Saved their answer to ${scenarioId}.` : `Cleared the answer to ${scenarioId}.`;
        return text(`${done} ${fresh} new answer${fresh === 1 ? "" : "s"} since the last update.`);
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, voiceTrain, { execute: async ({ action }) =>
      withDashboardErrors(async () => {
        if (action === "status") return text(formatDraft(await dashboard.get<DraftState>("/api/voice/train")));
        const r = await dashboard.post<{ started: boolean }>("/api/voice/train", { wait: false });
        return text(
          r.started
            ? `Drafting in the background. ${DRAFT_HINT} Check with voice_train action:status.`
            : "A draft is already running. Check with voice_train action:status.",
        );
      }) },
    (result) => result as DashboardToolResult);

  registerAction(server, voiceApply, { refuse: () => text("voice_apply rewrites learned-voice.md and changes how agents write as the user. Pass confirm:true to save immediately.", true), execute: async ({ content }) =>
      withDashboardErrors(async () => {

        const r = await dashboard.post<{ synced: boolean; syncError?: string }>("/api/voice/apply", content === undefined ? {} : { content }, 60_000);
        return text(
          r.synced
            ? "Saved to my-voice and synced to the agent tools."
            : `Saved to my-voice, but syncing it to the agent tools failed: ${r.syncError ?? "unknown error"}. Run a skill sync.`,
        );
      }) },
    (result) => result as DashboardToolResult);
}
