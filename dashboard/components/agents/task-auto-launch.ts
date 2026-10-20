import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { createPersistedBoolStore } from "@/lib/hooks/use-persisted-bool";
import { profileKey } from "@/lib/tasks/profile-scope";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { withStepTier, type ModelTier, type ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";
import type { AutoLaunchOptions } from "@/lib/storyboard/launch-options";

const useRememberedAuto = createPersistedBoolStore("devhub:agent-run-on-auto-change");

/**
 * `forced`: opened from "Start on auto", so Run on auto starts checked whatever the remembered choice is.
 * Unchecking it there is for this launch only and does not change the remembered default.
 */
export function useTaskAutoLaunch(available: boolean, forced = false) {
  const profiles = useLive<TaskProfileOverview>(available ? "/api/tasks/profiles" : null);
  const profile = profiles.data ? profiles.data.active ?? "legacy" : undefined;
  const [remembered, setRemembered] = useRememberedAuto(profileKey("devhub:agent-run-on-auto", profile ?? "pending")!);
  const [launchChoice, setLaunchChoice] = useState(true);
  const checked = forced ? launchChoice : remembered;
  return { profile, profileError: Boolean(profiles.error), runOnAuto: available && profile !== undefined && checked, setRunOnAuto: forced ? setLaunchChoice : setRemembered };
}

export function extraTaskInstructions(prompt: string, generated: string): string {
  if (prompt.includes(generated)) return prompt.replace(generated, "").trim();
  const defaultLines = new Set(generated.split("\n"));
  return prompt.split("\n").filter((line) => !defaultLines.has(line)).join("\n").trim();
}

interface LaunchChoice { provider: string; model: string; effort: string }

export function taskAutoLaunchOptions(input: {
  choice: LaunchChoice; review?: LaunchChoice; tier?: ModelTier; settings?: ModelTierSettings;
  instructions: string; worktree: boolean; skipPlan?: boolean;
}): AutoLaunchOptions & { tiers?: ModelTierSettings } {
  const { choice, review, tier, settings, instructions, worktree, skipPlan } = input;
  const tierChoice = tier && settings ? settings.tiers[tier] : undefined;
  const onTier = tierChoice && (!tierChoice.provider || tierChoice.provider === choice.provider) && tierChoice.model === choice.model;
  const tiers = onTier && settings && tier ? withStepTier(withStepTier(settings, "plan", tier), "implement", tier) : settings;
  const stepChoice = onTier ? { effort: choice.effort } : choice;
  // Plan and implement share the launch choice; review and PR keep their saved tiers unless a reviewer is picked.
  return {
    ...(tiers ? { tiers } : {}),
    stepOverrides: { plan: stepChoice, implement: stepChoice, ...(review?.provider ? { review } : {}) },
    ...(instructions ? { instructions } : {}),
    worktree,
    ...(skipPlan ? { skipPlan: true } : {}),
  };
}
