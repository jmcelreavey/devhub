import { z } from "zod";
import { defineAction } from "./define.ts";

export const eventStreamInput = z.object({
  // eslint-disable-next-line no-control-regex -- Reject control characters in repository names.
  repo: z.array(z.string().min(1).max(255).refine((name) => name !== "." && name !== ".." && !/[\\/\x00-\x1f]/.test(name))).max(64),
  repos: z.boolean(), checkout: z.boolean(), content: z.boolean(),
  plugins: z.boolean(), records: z.boolean(), recall: z.boolean(), docs: z.boolean(),
  db: z.boolean(), skills: z.boolean(), sync: z.boolean(),
});
export const eventStream = defineAction<typeof eventStreamInput, { execute: () => Response }, Response>({
  input: eventStreamInput,
  http: { method: "GET", path: "/api/events" },
  mcp: { reason: "The browser receives an open invalidation stream, not a condition or a single result." },
  handler: (_input, context) => context.execute(),
});

export const EVENT_WAIT_KINDS = ["pr", "script_run", "agent_run", "datadog_alert", "recall_event"] as const;
export const EVENT_RECALL_KINDS = ["commit", "pr", "ticket", "run", "session", "note", "alert", "decision", "manual"] as const;
export const EVENT_WAIT_NAME = "events_wait";
export const EVENT_WAIT_DESCRIPTION = "Block until something happens outside this session, instead of polling: kind=pr (repo+number; until checks_done | review | merged_or_closed | any_change), script_run or agent_run (runId; until it finishes), datadog_alert (a new alert, optional title match), recall_event (a new event in the recall spine, optional recallKinds and title match). Returns what happened, or the last status on timeout. Requires the dashboard running (and gh auth for pr).";
export const eventWaitInput = z.object({
  kind: z.enum(EVENT_WAIT_KINDS),
  repo: z.string().optional(), number: z.number().int().positive().optional(),
  until: z.enum(["checks_done", "review", "merged_or_closed", "any_change"]).optional(),
  runId: z.string().optional(), match: z.string().max(200).optional(),
  recallKinds: z.array(z.enum(EVENT_RECALL_KINDS)).optional(),
  timeoutSeconds: z.number().int().min(5).max(300).optional(),
});
type EventWaitResult = {
  content: Array<{ type: "text"; text: string } | { type: "resource"; resource: { uri: string; mimeType: string; text: string } }>;
  isError?: boolean;
};
export const eventWait = defineAction<typeof eventWaitInput, { execute: () => Promise<EventWaitResult> }, EventWaitResult>({
  input: eventWaitInput,
  http: { reason: "Waiting for one condition uses request-scoped timeout, progress and cancellation; the browser stream only invalidates domains." },
  mcp: { name: EVENT_WAIT_NAME, toolset: "events", description: EVENT_WAIT_DESCRIPTION },
  handler: (_input, context) => context.execute(),
});
