import { describe, expect, it } from "vitest";
import { autoLaunchCheckout, autoTierDispatch, type AutoLaunchOptions } from "./launch-options";
import { DEFAULT_MODEL_TIERS, TIER_STEPS, type ModelTierSettings } from "./model-tiers-shared";

const settings: ModelTierSettings = { ...DEFAULT_MODEL_TIERS, tiers: {
  cheap: { provider: "claude", model: "haiku", effort: "low" },
  mid: { provider: "codex", model: "gpt-6", effort: "high" },
  heavy: { provider: "claude", model: "opus", effort: "max" },
} };

describe("explicit checkout choice", () => {
  const suggested = { mode: "worktree" as const, reason: "dirty checkout", decidedAt: "now" };
  it("honours an unchecked worktree option even for a dirty checkout", () => {
    expect(autoLaunchCheckout(suggested, { worktree: false }).mode).toBe("checkout");
  });
  it("keeps automatic selection when no choice was supplied", () => {
    expect(autoLaunchCheckout(suggested)).toBe(suggested);
    expect(autoLaunchCheckout({ ...suggested, mode: "checkout" }, { worktree: true }).mode).toBe("worktree");
  });
});

describe("autoTierDispatch", () => {
  it.each(TIER_STEPS)("resolves provider, model and effort together for %s", (step) => {
    expect(autoTierDispatch(settings, step)).toEqual(settings.tiers[settings.steps[step]]);
  });

  it.each(TIER_STEPS)("omits effort on legacy %s runs", (step) => {
    expect(autoTierDispatch(DEFAULT_MODEL_TIERS, step)).not.toHaveProperty("effort");
  });

  it.each(["plan", "implement", "review"] as const)("lets sheet effort override %s for this run only", (step) => {
    const options: AutoLaunchOptions = { stepOverrides: { [step]: { provider: "codex", model: "gpt-6-sol", effort: "medium" } } };
    expect(autoTierDispatch(settings, step, undefined, options)).toEqual({ provider: "codex", model: "gpt-6-sol", effort: "medium" });
    expect(settings.tiers[settings.steps[step]].effort).not.toBe("medium");
    expect(autoTierDispatch(settings, "draft-pr", undefined, options).effort).toBe("low");
  });

  it.each([undefined, ""])("inherits tier effort when the sheet effort is Default (%s)", (effort) => {
    expect(autoTierDispatch(settings, "plan", undefined, { stepOverrides: { plan: { provider: "claude", model: "sonnet", effort } } })).toEqual({ provider: "claude", model: "sonnet", effort: "high" });
  });

  it("takes effort from an escalated tier, unless the sheet overrides it", () => {
    expect(autoTierDispatch(settings, "implement", { tier: "heavy" }).effort).toBe("max");
    expect(autoTierDispatch(settings, "implement", { tier: "heavy" }, { stepOverrides: { implement: { effort: "medium" } } }).effort).toBe("medium");
  });

  it("supports launch overrides without recorded tiers", () => {
    expect(autoTierDispatch(undefined, "plan")).toEqual({});
    expect(autoTierDispatch(undefined, "plan", undefined, { stepOverrides: { plan: { effort: "high" } } })).toEqual({ effort: "high" });
  });
});
