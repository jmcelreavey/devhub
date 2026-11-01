import { expect, it } from "vitest";
import { AutoLaunchOptionsSchema, autoTierDispatch } from "../../../../packages/shared/ui-lib/storyboard/launch-options";
import { DEFAULT_MODEL_TIERS } from "../../../../packages/shared/ui-lib/storyboard/model-tiers-shared";
import { taskAutoLaunchOptions } from "./task-auto-launch";

it("dispatches the ready provider shown by the launch sheet when a tier has no provider", () => {
  // The preferred Cursor is unavailable; the sheet has selected ready Claude.
  const launch = taskAutoLaunchOptions({
    choice: { provider: "claude", model: "", effort: "" },
    tier: "mid",
    settings: DEFAULT_MODEL_TIERS,
    instructions: "Change the fixture marker",
    worktree: false,
    skipPlan: true,
  });
  const options = AutoLaunchOptionsSchema.parse(launch);

  for (const step of ["plan", "implement"] as const) {
    expect(autoTierDispatch(launch.tiers, step, undefined, options).provider).toBe("claude");
  }
  expect(options.stepOverrides?.review).toBeUndefined();
});
