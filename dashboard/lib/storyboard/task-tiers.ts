import { getNotesDir } from "@/lib/notes/dir";
import { readModelTiers, tierStepForRole, type ModelTier, type TierStep } from "./model-tiers";
import { readOrchestration } from "./orchestration-store";
import { autoStepChoice, autoTierDispatch, type AutoLaunchOptions } from "./launch-options";

export interface TaskTierChoice {
  step: TierStep;
  tier: ModelTier;
  provider: string;
  model: string;
  effort?: string;
  /** `auto`: the tiers the task was started on auto with. `defaults`: the saved board defaults. */
  source: "auto" | "defaults";
  override?: boolean;
}

/**
 * The tier a task's agent run takes for its step. A task on auto keeps the
 * tiers it was started with; anything else uses the saved defaults. Every
 * dispatch for a task goes through this (lib/agent-runs/dispatch.ts), so plan,
 * implement, review and fix runs all land on their step's tier.
 */
export function taskTierChoice(taskId: string, role: string | undefined, notesDir = getNotesDir(), pickedTier?: ModelTier): TaskTierChoice {
  let fromAuto: ReturnType<typeof readModelTiers> | undefined;
  let launchOptions: AutoLaunchOptions | undefined;
  const step = tierStepForRole(role);
  try {
    const record = readOrchestration(taskId, notesDir);
    fromAuto = record?.tiers;
    launchOptions = record?.launchOptions;
  } catch {
    fromAuto = undefined;
  }
  const settings = fromAuto ?? readModelTiers(notesDir);
  const launch = autoStepChoice(launchOptions, step);
  // A tier picked at launch (the inline tier control) wins over the step's default.
  const tier = launch?.provider ? settings.steps[step] : pickedTier ?? settings.steps[step];
  const choice = autoTierDispatch(settings, step, { tier }, launchOptions);
  return { step, tier, provider: choice.provider ?? "", model: choice.model ?? "", ...(choice.effort ? { effort: choice.effort } : {}), source: fromAuto || launch?.provider ? "auto" : "defaults", ...(launch?.provider ? { override: true } : {}) };
}
