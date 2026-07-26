import { describe, it, expect } from "vitest";
import {
  GOALS,
  ALWAYS_STEPS,
  stepsForGoals,
  filterStepsByGoals,
  parseGoals,
} from "@/lib/setup/goals";

const ALL_STEPS = [
  { id: "welcome" },
  { id: "tools" },
  { id: "paths" },
  { id: "github" },
  { id: "datadog" },
  { id: "calendar" },
  { id: "jira" },
  { id: "bi" },
  { id: "agent" },
  { id: "done" },
];

describe("stepsForGoals", () => {
  it("always includes orientation, tools, paths and finish", () => {
    for (const step of ALWAYS_STEPS) {
      expect(stepsForGoals(["notes"]).has(step)).toBe(true);
    }
  });

  it("shows everything when no goal is chosen", () => {
    // Skipping the question must not produce an empty wizard. Silence means
    // "don't filter", not "want nothing".
    const all = stepsForGoals([]);
    expect(all.has("datadog")).toBe(true);
    expect(all.has("github")).toBe(true);
    expect(all.size).toBe(ALL_STEPS.length);
  });

  it("drops steps the chosen goal doesn't need", () => {
    const notes = stepsForGoals(["notes"]);
    expect(notes.has("calendar")).toBe(true);
    expect(notes.has("datadog")).toBe(false);
    expect(notes.has("github")).toBe(false);
  });

  it("unions multiple goals", () => {
    const both = stepsForGoals(["code", "ops"]);
    expect(both.has("github")).toBe(true);
    expect(both.has("datadog")).toBe(true);
    expect(both.has("calendar")).toBe(false);
  });

  it("'everything' matches the unfiltered set", () => {
    expect(stepsForGoals(["everything"])).toEqual(stepsForGoals([]));
  });

  it("ignores an unknown goal rather than throwing", () => {
    expect(stepsForGoals(["nonsense" as never]).size).toBe(ALL_STEPS.length);
  });
});

describe("filterStepsByGoals", () => {
  it("preserves the original order", () => {
    const out = filterStepsByGoals(ALL_STEPS, ["code"]).map((s) => s.id);
    expect(out).toEqual(["welcome", "tools", "paths", "github", "agent", "done"]);
  });

  it("never returns fewer than the always-on steps", () => {
    expect(filterStepsByGoals(ALL_STEPS, ["notes"]).length).toBeGreaterThanOrEqual(
      ALWAYS_STEPS.length,
    );
  });

  it("keeps every step when nothing is chosen", () => {
    expect(filterStepsByGoals(ALL_STEPS, []).length).toBe(ALL_STEPS.length);
  });
});

describe("parseGoals", () => {
  it("round-trips a saved list", () => {
    expect(parseGoals(JSON.stringify(["code", "ops"]))).toEqual(["code", "ops"]);
  });

  it("returns empty for null, junk, or a non-array", () => {
    expect(parseGoals(null)).toEqual([]);
    expect(parseGoals("not json")).toEqual([]);
    expect(parseGoals(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("drops entries that aren't real goals", () => {
    expect(parseGoals(JSON.stringify(["code", "bogus", 42]))).toEqual(["code"]);
  });
});

describe("the goal catalogue", () => {
  it("has unique ids", () => {
    const ids = GOALS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every goal a plain-language description", () => {
    for (const g of GOALS) {
      expect(g.description.length, `${g.id} has no description`).toBeGreaterThan(10);
      expect(g.label).not.toMatch(/[A-Z]{3,}/); // no acronyms in the label
    }
  });

  it("covers every optional step across the goals", () => {
    // A step no goal reaches would be unreachable for anyone who answers the
    // question - which is worse than not filtering at all.
    const reachable = new Set(GOALS.flatMap((g) => g.steps));
    const optional = ALL_STEPS.map((s) => s.id).filter((id) => !ALWAYS_STEPS.includes(id));
    for (const id of optional) {
      expect(reachable.has(id), `no goal offers step "${id}"`).toBe(true);
    }
  });
});
