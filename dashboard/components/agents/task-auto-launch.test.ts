import { describe, expect, it } from "vitest";
import { extraTaskInstructions, taskAutoLaunchOptions } from "./task-auto-launch";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";

describe("extraTaskInstructions", () => {
  const generated = "Built-in first line\nBuilt-in second line";
  it("doesn't duplicate the generated brief", () => {
    expect(extraTaskInstructions(generated, generated)).toBe("");
    expect(extraTaskInstructions(`${generated}\nExtra`, generated)).toBe("Extra");
    expect(extraTaskInstructions(`Extra\n${generated}`, generated)).toBe("Extra");
    expect(extraTaskInstructions("Built-in first line\nChanged instruction\nExtra", generated)).toBe("Changed instruction\nExtra");
    expect(extraTaskInstructions("Custom instructions", generated)).toBe("Custom instructions");
  });
});

describe("taskAutoLaunchOptions", () => {
  it("maps a selected tier to plan and implement without overwriting other steps", () => {
    const settings = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, heavy: { provider: "codex", model: "gpt-6-sol" } } };
    const options = taskAutoLaunchOptions({ choice: { provider: "codex", model: "gpt-6-sol", effort: "high" }, tier: "heavy", settings, instructions: "", worktree: true });
    expect(options.tiers?.steps).toEqual({ ...settings.steps, plan: "heavy", implement: "heavy" });
    expect(options.stepOverrides).toEqual({ plan: { effort: "high" }, implement: { effort: "high" } });
    expect(options.instructions).toBeUndefined();
  });
});
