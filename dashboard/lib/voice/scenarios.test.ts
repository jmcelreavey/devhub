import { describe, expect, it } from "vitest";
import { findScenario, VOICE_SCENARIOS } from "./scenarios";

describe("VOICE_SCENARIOS", () => {
  it("has unique, slug-shaped ids, because answers are stored against them", () => {
    const ids = VOICE_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every scenario a circumstance and an action", () => {
    for (const s of VOICE_SCENARIOS) {
      expect(s.situation.trim().length).toBeGreaterThan(20);
      expect(s.task.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers every register, so the quiz isn't all Slack", () => {
    const registers = new Set(VOICE_SCENARIOS.map((s) => s.register));
    expect([...registers].sort()).toEqual(["chat", "commit", "email", "feedback", "pr", "slack", "ticket"]);
  });

  it("finds a scenario by id and returns undefined for a retired one", () => {
    expect(findScenario(VOICE_SCENARIOS[0].id)).toBe(VOICE_SCENARIOS[0]);
    expect(findScenario("long-gone")).toBeUndefined();
  });
});
