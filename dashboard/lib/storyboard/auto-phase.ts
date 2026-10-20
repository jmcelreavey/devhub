/** Client-safe auto-mode helpers: which execution step and board column each phase means. */
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import type { AutoPhase, ExecutionStep, OrchestrationStatus } from "./types";

export function stepForPhase(phase: AutoPhase): ExecutionStep {
  if (phase === "plan") return "plan";
  if (phase === "draft-pr") return "draft-pr";
  if (phase === "verify" || phase === "ready") return "verify";
  return "implement";
}

/** The note status (board column) a phase puts the card in. */
export function columnForPhase(phase: AutoPhase): TaskNoteStatus {
  switch (phase) {
    case "plan":
      return "planning";
    case "baseline":
    case "implement":
    case "draft-pr":
      return "in-progress";
    case "verify":
    case "fix":
      return "draft-pr";
    case "ready":
      return "ready-for-review";
  }
}


/** The card's one progress line, in plain English: "Auto · Reviewing (4/5)". */
const PROGRESS: Record<AutoPhase, { step: number; label: string }> = {
  plan: { step: 1, label: "Planning" },
  baseline: { step: 2, label: "Recording the before video" },
  implement: { step: 2, label: "Building" },
  "draft-pr": { step: 3, label: "Opening a draft PR" },
  verify: { step: 4, label: "Reviewing" },
  fix: { step: 4, label: "Fixing" },
  ready: { step: 5, label: "Ready for review" },
};
export const AUTO_PROGRESS_STEPS = 5;

export interface AutoProgressInput {
  /** Board cards carry the phase as a plain string. */
  phase: AutoPhase | string;
  status?: OrchestrationStatus;
  round: number;
  maxRounds: number;
  waiting?: { kind: "questions" | "failure" | "cap" | "queued" | "plan-approval" };
}

export function autoProgress(auto: AutoProgressInput): string {
  if (auto.status === "needs-you" && auto.waiting?.kind === "plan-approval") return "Plan ready";
  const known = PROGRESS[auto.phase as AutoPhase] as { step: number; label: string } | undefined;
  if (!known) return "Auto";
  const { step, label } = known;
  const round = auto.phase === "fix" ? `, round ${auto.round} of ${auto.maxRounds}` : "";
  const manual = auto.status === "paused-manual";
  const paused = auto.status === "paused" || auto.status === "needs-you";
  const state = manual ? "" : paused ? " · paused" : !auto.waiting ? "" : auto.waiting.kind === "queued" ? " · waiting for a free slot" : " · paused";
  if (auto.phase === "ready") return `Auto · Ready for review (${step}/${AUTO_PROGRESS_STEPS})`;
  return `${manual ? "Manual" : "Auto"} · ${label}${round} (${step}/${AUTO_PROGRESS_STEPS})${state}`;
}
