import { describe, expect, it } from "vitest";
import {
  countSkillsBySource,
  filterSkillsBySource,
  type SkillListItem,
} from "./skills-api-types";

const sample: SkillListItem[] = [
  { name: "a", description: null, source: "devhub", readOnly: false },
  { name: "b", description: null, source: "ai-tools", readOnly: true },
  { name: "c", description: null, source: "devhub", readOnly: false, overridesUpstream: true },
];

describe("skills-api-types", () => {
  it("counts skills by source", () => {
    expect(countSkillsBySource(sample)).toEqual({ all: 3, devhub: 2, "ai-tools": 1 });
  });

  it("filters skills by source", () => {
    expect(filterSkillsBySource(sample, "ai-tools").map((s) => s.name)).toEqual(["b"]);
  });
});
