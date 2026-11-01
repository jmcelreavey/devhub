import { z } from "zod";

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const Url = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use an HTTP(S) URL without credentials.");
export const GoalSchema = z.object({
  id: Id, description: z.string().min(1).max(1000),
  assertion: z.enum(["text", "visible", "url", "no-errors", "screenshot"]),
  selector: z.string().min(1).max(500).optional(), expected: z.string().max(2000).optional(),
}).refine(goal => ["visible", "no-errors"].includes(goal.assertion) || Boolean(goal.expected), "This assertion requires an expected value.");
export const ActionSchema = z.object({
  id: Id, description: z.string().min(1).max(500),
  kind: z.enum(["click", "fill", "select", "keys", "wait", "scroll", "press"]),
  selector: z.string().max(500).optional(), value: z.string().max(2000).optional(),
  keys: z.array(z.enum(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Escape", "Tab", "a", "d", "w", "s", "j", "r"])).max(4).optional(),
  holdMs: z.number().int().min(20).max(2000).optional(),
});
export const ScenarioSchema = z.object({
  id: Id, title: z.string().min(1).max(200), surface: z.enum(["dom", "canvas", "desktop"]),
  url: Url.optional(), bundleId: z.string().regex(/^[a-zA-Z0-9.-]+$/).max(200).optional(),
  goals: z.array(GoalSchema).min(1).max(30), actions: z.array(ActionSchema).max(200).optional(),
  maxSteps: z.number().int().min(1).max(300).default(30),
  maxDurationMs: z.number().int().min(1000).max(600000).default(120000),
  maxCostUsd: z.number().positive().max(10).default(0.5),
  stallSteps: z.number().int().min(3).max(60).default(12),
  deathText: z.string().max(200).optional(), clearText: z.string().max(200).optional(),
  observeSelector: z.string().max(500).optional(), context: z.string().max(4000).optional(),
}).refine(value => value.surface === "desktop" ? Boolean(value.bundleId) : Boolean(value.url), "The runner needs an app bundle ID or URL.")
  .refine(value => new Set(value.goals.map(goal => goal.id)).size === value.goals.length, "Goal IDs must be unique.")
  .refine(value => !value.actions || new Set(value.actions.map(action => action.id)).size === value.actions.length, "Action IDs must be unique.");
export type SavedScenario = z.infer<typeof ScenarioSchema>;
export const SettingsSchema = z.object({
  experimentalImages: z.boolean().default(false),
  minConfidence: z.number().min(0).max(1).default(0.65),
  visionModel: z.string().max(200).default(""),
  visionEffort: z.string().max(40).default(""),
});
export type QaSettings = z.infer<typeof SettingsSchema>;
export const StartSchema = z.object({
  scenarioId: Id,
  requestId: z.string().uuid(),
  taskId: Id.optional(),
  revision: z.object({ label: z.enum(["base", "head"]), sha: z.string().regex(/^[a-f0-9]{7,40}$/) }).optional(),
  baseline: z.boolean().optional(),
});
export const QaPostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scenario"), scenario: ScenarioSchema }),
  z.object({ action: z.literal("settings"), settings: SettingsSchema }),
  z.object({ action: z.literal("run"), ...StartSchema.shape }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
]);
