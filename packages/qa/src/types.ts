export type Surface = "dom" | "canvas" | "desktop";
export interface QaAction {
  id: string;
  description: string;
  kind: "click" | "fill" | "select" | "keys" | "wait" | "scroll" | "press";
  selector?: string;
  value?: string;
  keys?: string[];
  holdMs?: number;
}
export interface QaGoal {
  id: string;
  description: string;
  assertion: "text" | "visible" | "url" | "no-errors" | "screenshot";
  selector?: string;
  expected?: string;
}
export interface GoalResult { id: string; description: string; passed: boolean; actual: string }
export interface Observation {
  text: string;
  fingerprint: string;
  screenshot?: Buffer;
  actions: QaAction[];
  terminal?: "death" | "clear";
}
export interface Artifact {
  file: string;
  kind: "image" | "video";
  phase: "before" | "after" | "failure";
  sha256: string;
}
export interface ModelUsage {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costBasis: "estimated" | "reported" | "unavailable";
  durationMs: number;
  error?: string;
}
export interface Decision {
  actionId: string;
  confidence: number;
  calls: ModelUsage[];
}
export interface DecisionInput {
  goal: string;
  observation: Observation;
  history: string[];
  signal: AbortSignal;
}
export type Policy = (input: DecisionInput) => Promise<Decision>;
export interface Routing {
  text: Policy;
  vision?: Policy;
  fallback?: Policy;
  experimentalImages: boolean;
  minConfidence: number;
}
export interface QaDriver {
  surface: Surface;
  start(signal: AbortSignal): Promise<void>;
  observe(signal: AbortSignal): Promise<Observation>;
  act(action: QaAction, signal: AbortSignal): Promise<void>;
  assert(goals: QaGoal[], signal: AbortSignal): Promise<GoalResult[]>;
  capture(phase: Artifact["phase"]): Promise<Artifact>;
  close(): Promise<Artifact[]>;
}
export interface QaScenario {
  id: string;
  title: string;
  surface: Surface;
  goals: QaGoal[];
  maxSteps: number;
  maxDurationMs: number;
  maxCostUsd: number;
  stallSteps: number;
}
export interface QaStep {
  index: number;
  at: string;
  action?: string;
  confidence?: number;
  observationHash: string;
  durationMs: number;
  calls: ModelUsage[];
  error?: string;
}
export interface QaReceipt {
  schemaVersion: 1;
  id: string;
  scenarioId: string;
  title: string;
  surface: Surface;
  startedAt: string;
  endedAt: string;
  status: "passed" | "failed" | "blocked" | "cancelled";
  stopReason: string;
  goals: GoalResult[];
  steps: QaStep[];
  artifacts: Artifact[];
  errors: string[];
  totals: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    unknownCostCalls: number;
  };
  revision?: { label: "base" | "head"; sha: string };
}
