import { generateDraft, planDraft } from "./train";
import type { VoiceProposal } from "./types";

export type VoiceDraftState =
  | { status: "idle" }
  | { status: "running"; startedAt: string }
  | { status: "ready"; finishedAt: string; proposal: VoiceProposal }
  | { status: "failed"; finishedAt: string; error: string };

/**
 * One draft at a time, held in memory. Drafting is a model call that takes a
 * minute or two, so a caller that can't wait (an MCP tool under a harness's
 * 60s limit) starts it and polls; and two at once just slow each other until
 * the CLI hits its time limit. Same shape as the conventions miner's in-flight map.
 */
let state: VoiceDraftState = { status: "idle" };
let running: Promise<VoiceProposal> | null = null;

export function getDraft(): VoiceDraftState {
  return state;
}

/**
 * Start a draft, or join the one already running (`started: false`). Throws
 * synchronously when drafting isn't possible, so every caller gets the real
 * reason immediately instead of a "failed" state a minute later.
 */
export function startDraft(): { started: boolean; done: Promise<VoiceProposal> } {
  if (running) return { started: false, done: running };

  const plan = planDraft();
  state = { status: "running", startedAt: new Date().toISOString() };
  const done = generateDraft(plan)
    .then(
      (proposal) => {
        state = { status: "ready", finishedAt: new Date().toISOString(), proposal };
        return proposal;
      },
      (err: unknown) => {
        state = {
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
        throw err;
      },
    )
    .finally(() => {
      running = null;
    });
  running = done;
  return { started: true, done };
}

/** Forget a finished draft (applied, or discarded). A draft still being generated is left alone. */
export function clearDraft(): void {
  if (!running) state = { status: "idle" };
}
