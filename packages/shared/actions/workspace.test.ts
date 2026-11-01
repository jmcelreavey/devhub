import { expect, test } from "vitest";
import { skillsProposeUpdateBodyInput } from "./workspace.ts";

test("skill proposals retain revision, successful-run citation and content boundaries", () => {
  const input = { skill: "fixture-skill", baseRevision: "a".repeat(64), runId: "run-abcdef-12345678", reason: "A concrete reason", evidence: "A completed run demonstrated the problem", content: "A complete replacement skill definition" };
  expect(skillsProposeUpdateBodyInput.parse(input)).toEqual(input);
  for (const change of [{ skill: "../outside" }, { baseRevision: "old" }, { runId: "uncited" }, { reason: "           " }, { evidence: "short" }, { content: " " }, { unreviewed: true }]) {
    expect(skillsProposeUpdateBodyInput.safeParse({ ...input, ...change }).success).toBe(false);
  }
});
