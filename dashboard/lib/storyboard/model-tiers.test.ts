import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { choiceForStep, DEFAULT_MODEL_TIERS, ModelTierSettingsSchema, readModelTiers, tierLabel, writeModelTiers } from "./model-tiers";

describe("model tiers", () => {
  it("parses old settings without adding an effort override", () => {
    expect(ModelTierSettingsSchema.parse(DEFAULT_MODEL_TIERS)).toEqual(DEFAULT_MODEL_TIERS);
    expect(choiceForStep(DEFAULT_MODEL_TIERS, "plan")).not.toHaveProperty("effort");
  });

  it("round-trips optional effort for every tier", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier-efforts-"));
    try {
      const saved = ModelTierSettingsSchema.parse({ ...DEFAULT_MODEL_TIERS, tiers: {
        cheap: { provider: "claude", model: "haiku", effort: "low" },
        mid: { provider: "codex", model: "gpt-6", effort: "high" },
        heavy: { provider: "claude", model: "opus", effort: "max" },
      } });
      writeModelTiers(saved, dir);
      expect(readModelTiers(dir)).toEqual(saved);
      expect(choiceForStep(readModelTiers(dir), "review").effort).toBe("max");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["high; echo unsafe", "x".repeat(33), null])("rejects an invalid effort token: %s", (effort) => {
    expect(ModelTierSettingsSchema.safeParse({ ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, mid: { provider: "codex", model: "gpt-6", effort } } }).success).toBe(false);
  });

  it("falls back to defaults and round-trips saved settings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tiers-"));
    expect(readModelTiers(dir)).toEqual(DEFAULT_MODEL_TIERS);
    const saved = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, cheap: { provider: "claude", model: "haiku" } } };
    writeModelTiers(saved, dir);
    expect(readModelTiers(dir)).toEqual(saved);
    expect(choiceForStep(saved, "verify")).toEqual({ tier: "cheap", provider: "claude", model: "haiku" });
  });
  it("labels a card's step, hiding unknown steps", () => {
    expect(tierLabel(DEFAULT_MODEL_TIERS, "plan", "claude")).toBe("Mid · claude");
    expect(tierLabel(DEFAULT_MODEL_TIERS, "nope")).toBeNull();
    expect(tierLabel(undefined, "plan")).toBeNull();
  });
});

describe("tier fill for task runs", () => {
  it("maps every run role onto a tier step", async () => {
    const { tierStepForRole } = await import("./model-tiers-shared");
    expect(["plan", "discuss", "implement", "verify", "review", "create-pr", "resume", "agent", undefined].map(tierStepForRole)).toEqual(["plan", "plan", "implement", "verify", "review", "draft-pr", "implement", "implement", "implement"]);
  });

  it("summarises and edits step tiers", async () => {
    const { describeTierChoice, tierSummary, withStepTier, DEFAULT_MODEL_TIERS } = await import("./model-tiers-shared");
    expect(tierSummary(DEFAULT_MODEL_TIERS)).toBe("Plan mid · Implement mid · Verify cheap · PR cheap · Review heavy");
    expect(withStepTier(DEFAULT_MODEL_TIERS, "implement", "heavy").steps.implement).toBe("heavy");
    expect(DEFAULT_MODEL_TIERS.steps.implement).toBe("mid");
    expect(describeTierChoice({ provider: "", model: "" })).toBe("Preferred agent");
    expect(describeTierChoice({ provider: "claude", model: "opus" })).toBe("claude · opus");
  });

  it("fills what the caller left blank, and an explicit pick wins", async () => {
    const { fillFromTier } = await import("./model-tiers-shared");
    const tier = { provider: "claude", model: "opus" };
    expect(fillFromTier({ provider: "" }, tier, "codex")).toEqual({ provider: "claude", model: "opus", onTier: true });
    expect(fillFromTier({ provider: "claude" }, tier, "codex")).toEqual({ provider: "claude", model: "opus", onTier: true });
    // A different provider keeps its own default model, and the log does not claim the tier.
    expect(fillFromTier({ provider: "codex" }, tier, "codex")).toEqual({ provider: "codex", onTier: false });
    expect(fillFromTier({ provider: "claude", model: "sonnet" }, tier, "codex")).toEqual({ provider: "claude", model: "sonnet", onTier: false });
    // "Agent default" tier: nothing to fill, but the run is still on it.
    expect(fillFromTier({ provider: "" }, { provider: "", model: "" }, "codex")).toEqual({ provider: "", onTier: true });
  });
});
