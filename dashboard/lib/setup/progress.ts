import { z } from "zod";

export const SETUP_STEP_IDS = [
  "welcome", "tools", "paths", "github", "datadog", "calendar", "jira", "bi", "agent", "done",
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export const SetupProgressSchema = z.object({
  completed: z.boolean().default(false),
  completedAt: z.string().nullable().default(null),
  currentStep: z.enum(SETUP_STEP_IDS).default("welcome"),
  goals: z.array(z.enum(["code", "notes", "ops", "everything"])).max(4).default([]),
  skipped: z.array(z.enum(SETUP_STEP_IDS)).max(10).default([]),
  /** "Not now" on the reminder to back content up to a private repo. */
  contentRepoReminderDismissed: z.boolean().default(false),
});
export type SetupProgress = z.infer<typeof SetupProgressSchema>;
export const SaveSetupProgressSchema = z.object({
  completed: z.boolean().optional(),
  currentStep: z.enum(SETUP_STEP_IDS).optional(),
  goals: z.array(z.enum(["code", "notes", "ops", "everything"])).max(4).optional(),
  skipped: z.array(z.enum(SETUP_STEP_IDS)).max(10).optional(),
  contentRepoReminderDismissed: z.boolean().optional(),
});

/** `?step=github` on /setup opens that step: the way back in from reminders and other pages. */
export function requestedSetupStep(search: string): SetupStepId | null {
  const requested = new URLSearchParams(search).get("step");
  return (SETUP_STEP_IDS as readonly string[]).includes(requested ?? "") ? (requested as SetupStepId) : null;
}
