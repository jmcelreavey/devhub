import { z } from "zod";
import { ModelTierSettingsSchema } from "./model-tiers-shared";
import { AutoLaunchOptionsSchema } from "./launch-options";
import { AUTO_PHASES, EXECUTION_STEPS, ORCHESTRATION_SCHEMA_VERSION, ORCHESTRATION_STATUSES } from "./types";

const text = (max: number) => z.string().max(max);
const iso = z.string().datetime();
const httpsUrl = z.string().max(2000).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Only https links are allowed");

export const IdempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/, "Invalid idempotency key");
const StepIdSchema = z.enum(EXECUTION_STEPS);

/** Task IDs double as orchestration file names; same alphabet as task-run sidecars. */
export const TaskIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, "Invalid task ID");
const TaskDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "taskDate must be YYYY-MM-DD");

const AutoPhaseSchema = z.enum(AUTO_PHASES);
const TierSchema = z.enum(["cheap", "mid", "heavy"]);
const AutoStateSchema = z.object({
  cycleId: z.string().uuid().optional(),
  feedbackKey: text(80).optional(),
  feedbackBrief: text(4000).optional(),
  pauseAfterPlan: z.boolean().optional(),
  recoveryGuidance: z.object({ text: text(4500), phase: AutoPhaseSchema, attempt: z.number().int().nonnegative() }).optional(),
  phase: AutoPhaseSchema,
  round: z.number().int().min(0).max(20),
  maxRounds: z.number().int().min(0).max(20),
  attempt: z.number().int().min(0).max(50),
  origin: text(300),
  runs: z.array(z.object({
    feedbackKey: text(80).optional(),
    runId: text(80).min(1),
    phase: AutoPhaseSchema,
    round: z.number().int().min(0).max(20),
    attempt: z.number().int().min(0).max(50),
    tier: TierSchema.optional(),
    tierReason: text(300).optional(),
    at: iso,
  })).max(200),
  waiting: z.object({ kind: z.enum(["questions", "failure", "cap", "queued", "plan-approval"]), reason: text(1000).min(1), at: iso, next: AutoPhaseSchema.optional() }).optional(),
  work: z.object({
    cwd: text(1000).min(1),
    worktree: z.object({ path: text(1000), branch: text(300), repoRoot: text(1000) }).optional(),
    baseSha: text(64).optional(),
  }).optional(),
  baselineQaRunId: text(80).optional(),
  verify: z.object({
    reviewRunId: text(80).optional(),
    reviewDone: z.boolean().optional(),
    qaRunId: text(80).optional(),
    qaDone: z.boolean().optional(),
    qaBugs: z.number().int().min(0).max(1000).optional(),
    qaSkipped: text(500).optional(),
  }).optional(),
  findings: z.array(text(500)).max(40).optional(),
  ui: z.object({ detected: z.boolean(), reason: text(500), override: z.boolean().optional() }).optional(),
  preview: z.object({ state: z.enum(["url", "started", "starting", "none"]), url: text(2000).optional(), reason: text(500) }).optional(),
});

export const OrchestrationRecordSchema = z.object({
  schemaVersion: z.literal(ORCHESTRATION_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  taskId: TaskIdSchema,
  taskDate: TaskDateSchema,
  executionStep: StepIdSchema,
  status: z.enum(ORCHESTRATION_STATUSES),
  runIds: z.array(text(80).min(1)).max(200),
  questions: z.array(z.object({
    id: text(80).min(1),
    stepId: StepIdSchema,
    kind: z.enum(["repo", "blocker"]),
    prompt: text(2000).min(1),
    state: z.enum(["open", "answered"]),
    askedAt: iso,
    answeredAt: iso.optional(),
    answer: text(2000).optional(),
  })).max(100),
  terminal: z.object({ kind: z.literal("pr-created"), at: iso, prUrl: httpsUrl.optional() }).nullable(),
  repo: z.object({ name: text(200).optional(), cwd: text(1000).optional() }).optional(),
  checkout: z.object({ mode: z.enum(["checkout", "worktree"]), reason: text(500).min(1), decidedAt: iso }).optional(),
  lastError: text(2000).optional(),
  /** Tiers chosen at kickoff; without this field the write path strips them. */
  tiers: ModelTierSettingsSchema.optional(),
  launchOptions: AutoLaunchOptionsSchema.optional(),
  auto: AutoStateSchema.optional(),
  createdAt: iso,
  updatedAt: iso,
  idempotency: z.array(z.object({ key: IdempotencyKeySchema, at: iso })).max(200),
});

/** Start on auto. `cwd`/`repoName` come from the row when it already knows its checkout. */
export const OrchestrateStartSchema = z.object({
  ...AutoLaunchOptionsSchema.shape,
  pauseAfterPlan: z.boolean().optional(),
  action: z.literal("start"),
  taskId: TaskIdSchema,
  taskDate: TaskDateSchema,
  idempotencyKey: IdempotencyKeySchema,
  cwd: text(1000).trim().min(1).optional(),
  repoName: text(200).trim().min(1).optional(),
  /** Cheap/mid/heavy choice made at kickoff; omitted = saved defaults. */
  tiers: ModelTierSettingsSchema.optional(),
});
export type OrchestrateStartInput = z.infer<typeof OrchestrateStartSchema>;

/**
 * Answer the missing-repo question: link the picked repo to the task and
 * resume auto in one call. Only the folder is sent; the server resolves the
 * canonical repo name from it instead of trusting a client-supplied name.
 */
export const OrchestrateAnswerRepoSchema = z.object({
  action: z.literal("answer-repo"),
  taskId: TaskIdSchema,
  taskDate: TaskDateSchema,
  idempotencyKey: IdempotencyKeySchema,
  cwd: text(1000).trim().min(1),
});
export type OrchestrateAnswerRepoInput = z.infer<typeof OrchestrateAnswerRepoSchema>;

/** Auto/Manual switch. Manual cancels the active run; Auto resumes. */
export const OrchestrateModeSchema = z.object({
  guidance: z.string().trim().min(1).max(4500).optional(),
  action: z.literal("mode"),
  taskId: TaskIdSchema,
  mode: z.enum(["auto", "manual"]),
  idempotencyKey: IdempotencyKeySchema,
});
export type OrchestrateModeInput = z.infer<typeof OrchestrateModeSchema>;

/** Needs you → carry on: retry a failed step (on a higher tier), take one more fix round past the cap, or continue once questions are answered. */
export const OrchestrateRetrySchema = z.object({
  guidance: z.string().trim().min(1).max(4000).optional(),
  action: z.literal("retry"),
  taskId: TaskIdSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type OrchestrateRetryInput = z.infer<typeof OrchestrateRetrySchema>;

/** Back to To do: stop the runs and forget auto mode. `discardWork` also removes the agent checkouts and their local agent branches. */
export const OrchestrateResetSchema = z.object({
  action: z.literal("reset"),
  taskId: TaskIdSchema,
  discardWork: z.boolean().default(false),
});
export type OrchestrateResetInput = z.infer<typeof OrchestrateResetSchema>;

/** Reply to a question with a question: the agent is run again with it and the question stays open. */
export const OrchestrateAskBackSchema = z.object({
  action: z.literal("ask-back"),
  taskId: TaskIdSchema,
  text: z.string().trim().min(1).max(4000),
  idempotencyKey: IdempotencyKeySchema,
});
export type OrchestrateAskBackInput = z.infer<typeof OrchestrateAskBackSchema>;

/** Run the review or Jev QA again on the same checkout, from a finished or reviewing task. */
export const OrchestrateRerunSchema = z.object({
  action: z.literal("rerun"),
  taskId: TaskIdSchema,
  step: z.enum(["qa", "review"]),
  idempotencyKey: IdempotencyKeySchema,
});
export type OrchestrateRerunInput = z.infer<typeof OrchestrateRerunSchema>;

/** The card's "UI change" toggle: true/false overrides detection, null clears the override. */
export const OrchestrateUiSchema = z.object({
  action: z.literal("ui"),
  taskId: TaskIdSchema,
  ui: z.boolean().nullable(),
});
export type OrchestrateUiInput = z.infer<typeof OrchestrateUiSchema>;

export const OrchestratePlanDecisionSchema = z.object({
  action: z.literal("plan-decision"),
  taskId: TaskIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  planRunId: text(80).min(1),
  decision: z.enum(["approve", "revise"]),
  guidance: z.string().trim().min(1).max(4000).optional(),
});
export type OrchestratePlanDecisionInput = z.infer<typeof OrchestratePlanDecisionSchema>;

export const OrchestratePostSchema = z.discriminatedUnion("action", [OrchestratePlanDecisionSchema, OrchestrateStartSchema, OrchestrateAnswerRepoSchema, OrchestrateModeSchema, OrchestrateRetrySchema, OrchestrateUiSchema, OrchestrateResetSchema, OrchestrateRerunSchema, OrchestrateAskBackSchema]);
