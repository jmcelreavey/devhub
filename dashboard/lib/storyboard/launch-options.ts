import { z } from "zod";
import { choiceForStep, type ModelTier, type ModelTierSettings, type TierStep } from "./model-tiers-shared";
import type { OrchestrationCheckoutChoice } from "./types";

const AgentChoiceSchema = z.object({
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(80).optional(),
}).refine((choice) => (choice.provider === undefined) === (choice.model === undefined), "Choose both provider and model, or only an effort override");

export const AutoLaunchOptionsSchema = z.object({
  stepOverrides: z.object({
    plan: AgentChoiceSchema.optional(),
    implement: AgentChoiceSchema.optional(),
    review: AgentChoiceSchema.optional(),
  }).optional(),
  instructions: z.string().trim().max(32000).optional(),
  worktree: z.boolean().optional(),
  /** Start straight at Implement: the task, its ticket and the agent's own short plan stand in for a planning run. */
  skipPlan: z.boolean().optional(),
});
export type AutoLaunchOptions = z.infer<typeof AutoLaunchOptionsSchema>;

export function autoStepChoice(options: AutoLaunchOptions | undefined, step: TierStep) {
  if (step !== "plan" && step !== "implement" && step !== "review") return undefined;
  return options?.stepOverrides?.[step];
}

export function autoLaunchPrompt(prompt: string, options?: AutoLaunchOptions): string {
  return options?.instructions ? `${prompt}\n\nAdditional instructions from the user:\n${options.instructions}` : prompt;
}

export function autoLaunchCheckout(choice: OrchestrationCheckoutChoice, options?: AutoLaunchOptions): OrchestrationCheckoutChoice {
  if (options?.worktree === undefined) return choice;
  return { ...choice, mode: options.worktree ? "worktree" : "checkout", reason: options.worktree ? "isolated worktree requested at launch" : "shared checkout requested; stash and refresh before starting" };
}

export function autoTierDispatch(settings: ModelTierSettings | undefined, step: TierStep, picked?: { tier?: ModelTier }, options?: AutoLaunchOptions): { provider?: string; model?: string; effort?: string } {
  const choice = settings ? (picked?.tier ? settings.tiers[picked.tier] : choiceForStep(settings, step)) : undefined;
  const override = autoStepChoice(options, step);
  const provider = override?.provider ?? choice?.provider;
  const model = override?.model ?? choice?.model;
  // A launch-sheet effort wins for its stages; Default inherits the tier, for this run only.
  const effort = override?.effort?.trim() || choice?.effort;
  return { ...(provider !== undefined ? { provider } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
