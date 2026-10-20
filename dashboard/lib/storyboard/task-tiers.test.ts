import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_TIERS, writeModelTiers } from "./model-tiers";
import { taskTierChoice } from "./task-tiers";
import { mutateOrchestration } from "./orchestration-store";

let notesDir: string;
beforeEach(() => { notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-tiers-")); });
afterEach(() => { fs.rmSync(notesDir, { recursive: true, force: true }); });

function writeAuto(taskId: string, tiers: typeof DEFAULT_MODEL_TIERS) {
  const dir = path.join(notesDir, ".config", "storyboard", "orchestrations");
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, `${taskId}.json`), JSON.stringify({
    schemaVersion: 1, revision: 1, taskId, taskDate: "2026-10-17", executionStep: "implement", status: "running",
    runIds: [], questions: [], terminal: null, tiers, createdAt: now, updatedAt: now, idempotency: [],
  }));
}

describe("taskTierChoice", () => {
  it("resolves persisted effort and launch precedence after reload, including picked tiers", async () => {
    const tiers = { ...DEFAULT_MODEL_TIERS, tiers: {
      ...DEFAULT_MODEL_TIERS.tiers,
      mid: { provider: "codex", model: "gpt-6", effort: "high" },
      heavy: { provider: "claude", model: "opus", effort: "max" },
    } };
    writeAuto("task-effort", tiers);
    await mutateOrchestration("task-effort", null, (record) => {
      record!.launchOptions = { stepOverrides: { plan: { effort: "low" }, implement: { provider: "codex", model: "gpt-6-sol", effort: "" } } };
      return record;
    }, notesDir);
    expect(taskTierChoice("task-effort", "plan", notesDir).effort).toBe("low");
    expect(taskTierChoice("task-effort", "implement", notesDir, "heavy")).toMatchObject({ model: "gpt-6-sol", effort: "high", override: true });
    expect(taskTierChoice("task-effort", "review", notesDir).effort).toBe("max");
    expect(taskTierChoice("task-effort", "verify", notesDir)).not.toHaveProperty("effort");
  });

  it("uses pinned launch models even when a retry picks another tier", async () => {
    writeAuto("task-launch", DEFAULT_MODEL_TIERS);
    await mutateOrchestration("task-launch", null, (record) => {
      record!.launchOptions = { stepOverrides: { implement: { provider: "codex", model: "" } } };
      return record;
    }, notesDir);
    expect(taskTierChoice("task-launch", "implement", notesDir, "heavy")).toMatchObject({ provider: "codex", model: "", override: true });
    expect(taskTierChoice("task-launch", "review", notesDir).override).toBeUndefined();
  });
  it("uses the saved defaults for every step when the task is not on auto", () => {
    writeModelTiers({ ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, heavy: { provider: "claude", model: "opus" } } }, notesDir);
    expect(taskTierChoice("task-a", "review", notesDir)).toEqual({ step: "review", tier: "heavy", provider: "claude", model: "opus", source: "defaults" });
    expect(taskTierChoice("task-a", "implement", notesDir)).toMatchObject({ step: "implement", tier: "mid", source: "defaults" });
    // Follow-ups and PR fixes are implement work; discussing a plan is plan work.
    expect(taskTierChoice("task-a", "agent", notesDir).step).toBe("implement");
    expect(taskTierChoice("task-a", "discuss", notesDir).step).toBe("plan");
    expect(taskTierChoice("task-a", "create-pr", notesDir).step).toBe("draft-pr");
  });

  it("uses the tier picked at launch over the step default", () => {
    writeModelTiers({ ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, cheap: { provider: "codex", model: "mini" } } }, notesDir);
    expect(taskTierChoice("task-a", "implement", notesDir, "cheap")).toEqual({ step: "implement", tier: "cheap", provider: "codex", model: "mini", source: "defaults" });
  });

  it("keeps the tiers a task was started on auto with", () => {
    writeAuto("task-b", { ...DEFAULT_MODEL_TIERS, steps: { ...DEFAULT_MODEL_TIERS.steps, implement: "heavy" }, tiers: { ...DEFAULT_MODEL_TIERS.tiers, heavy: { provider: "codex", model: "gpt-6" } } });
    expect(taskTierChoice("task-b", "implement", notesDir)).toEqual({ step: "implement", tier: "heavy", provider: "codex", model: "gpt-6", source: "auto" });
  });
});
