import { z } from "zod";
import { WORKFLOW_STAGES } from "./types";

const text = z.string();
const timestamp = z.string().datetime();
export const WorkflowSchema = z.object({
  version: z.literal(1),
  taskId: text.regex(/^[a-zA-Z0-9_-]{1,128}$/),
  revision: z.number().int().nonnegative(),
  stage: z.enum(WORKFLOW_STAGES),
  status: z.enum(["active", "waiting-user", "blocked", "paused", "complete", "abandoned"]),
  checks: z.array(z.object({
    id: text, runId: text, cwd: text.optional(), fingerprint: text, command: text, startedAt: timestamp,
    finishedAt: timestamp.optional(), exitCode: z.number().int().nullable(),
    executionStarted: z.boolean().optional(), stale: z.boolean().optional(),
    outcome: z.enum(["running", "passed", "failed", "interrupted"]), detail: text.optional(),
  })),
  reviews: z.array(z.object({
    runId: text, fingerprint: text, findings: text, stale: z.boolean().optional(),
    verdict: z.enum(["pass", "changes-requested"]), recordedAt: timestamp,
  })),
  proposals: z.array(z.object({
    id: text, kind: z.enum(["commit-push", "draft-pr", "ticket-transition", "task-completion"]),
    runId: text, fingerprint: text, destination: text, content: text, contentHash: text,
    expiresAt: timestamp,
    state: z.enum(["pending", "approved", "rejected", "stale", "outcome-unknown", "succeeded", "failed"]),
  })),
  events: z.array(z.object({ id: text, at: timestamp, summary: text })),
  seenRevision: z.number().int().nonnegative(),
  runStates: z.record(text, z.object({ state: text, at: z.number() })).optional(),
});
