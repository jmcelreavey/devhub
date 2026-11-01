/** Client-safe tier types, schema and labels (no fs). */
import { z } from "zod";

/** Cost tiers Jev picks a model from at each step. Empty provider/model = agent default. */
export const MODEL_TIERS = ["cheap", "mid", "heavy"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export const TIER_STEPS = ["plan", "implement", "verify", "draft-pr", "review"] as const;
export type TierStep = (typeof TIER_STEPS)[number];

const Choice = z.object({
  provider: z.string().trim().max(64).default(""),
  model: z.string().trim().max(120).default(""),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
});
export const ModelTierSettingsSchema = z.object({
  tiers: z.object({ cheap: Choice, mid: Choice, heavy: Choice }),
  steps: z.object({ plan: z.enum(MODEL_TIERS), implement: z.enum(MODEL_TIERS), verify: z.enum(MODEL_TIERS), "draft-pr": z.enum(MODEL_TIERS), review: z.enum(MODEL_TIERS) }),
});
export type ModelTierSettings = z.infer<typeof ModelTierSettingsSchema>;
export type ModelTierChoice = ModelTierSettings["tiers"][ModelTier];

export const DEFAULT_MODEL_TIERS: ModelTierSettings = {
  tiers: { cheap: { provider: "", model: "" }, mid: { provider: "", model: "" }, heavy: { provider: "", model: "" } },
  steps: { plan: "mid", implement: "mid", verify: "cheap", "draft-pr": "cheap", review: "heavy" },
};

export const TIER_LABEL: Record<ModelTier, string> = { cheap: "Cheap", mid: "Mid", heavy: "Heavy" };
export const TIER_STEP_LABEL: Record<TierStep, string> = { plan: "Plan", implement: "Implement", verify: "Verify", "draft-pr": "PR", review: "Review" };

/** "claude · opus", "codex", or "Preferred agent" for an empty choice. */
export function describeTierChoice(choice: { provider: string; model: string }): string {
  if (!choice.provider && !choice.model) return "Preferred agent";
  return [choice.provider || "Preferred agent", choice.model].filter(Boolean).join(" · ");
}

/** "Plan mid · Implement mid · Verify cheap · PR cheap · Review heavy". */
export function tierSummary(settings: ModelTierSettings): string {
  return TIER_STEPS.map((step) => `${TIER_STEP_LABEL[step]} ${settings.steps[step]}`).join(" · ");
}

export function withStepTier(settings: ModelTierSettings, step: TierStep, tier: ModelTier): ModelTierSettings {
  return { ...settings, steps: { ...settings.steps, [step]: tier } };
}

/** The provider/model a step runs on under these settings. */
export function choiceForStep(settings: ModelTierSettings, step: TierStep): ModelTierChoice & { tier: ModelTier } {
  const tier = settings.steps[step];
  return { tier, ...settings.tiers[tier] };
}

/** "Mid · sonnet" style label for a card; model falls back to the run's provider, then "default". */
export function tierLabel(settings: ModelTierSettings | undefined, step: string | undefined, runProvider?: string): string | null {
  if (!settings || !step || !(TIER_STEPS as readonly string[]).includes(step)) return null;
  const choice = choiceForStep(settings, step as TierStep);
  return `${TIER_LABEL[choice.tier]} · ${choice.model || choice.provider || runProvider || "default"}`;
}

/** The tier step an agent run's role works under. Follow-ups, retries and PR fixes are implement work; discussing a plan is plan work. */
export function tierStepForRole(role: string | undefined): TierStep {
  switch (role) {
    case "plan":
    case "discuss":
      return "plan";
    case "verify":
      return "verify";
    case "review":
      return "review";
    case "draft-pr":
    case "create-pr":
      return "draft-pr";
    default:
      return "implement";
  }
}

/**
 * Fill what a dispatch left blank from a tier choice. An explicit pick wins; a
 * tier's model only rides along with its own provider. `onTier` says whether the
 * run ends up on the tier's choice, so the run log never claims a tier it did not use.
 */
export function fillFromTier(
  request: { provider?: string; model?: string; effort?: string },
  choice: ModelTierChoice,
  preferredProvider: string,
): { provider: string; model?: string; effort?: string; onTier: boolean } {
  const provider = request.provider?.trim() || choice.provider;
  const effective = (provider || preferredProvider).toLowerCase();
  const tierProvider = (choice.provider || preferredProvider).toLowerCase();
  const model = request.model?.trim() || (choice.model && effective === tierProvider ? choice.model : undefined);
  const onTier = effective === tierProvider && (!choice.model || model === choice.model);
  const effort = request.effort?.trim() || (onTier ? choice.effort : undefined);
  return { provider, ...(model ? { model } : {}), ...(effort ? { effort } : {}), onTier };
}
