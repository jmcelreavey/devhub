import { expect, test } from "vitest";
import { voiceAnswerInput, voiceApply } from "./voice.ts";

test("voice answers keep the verbatim text and its size boundary", () => {
  expect(voiceAnswerInput.parse({ scenarioId: "fixture", answer: "  Their own words.\n" }).answer).toBe("  Their own words.\n");
  expect(voiceAnswerInput.safeParse({ scenarioId: "fixture", answer: "x".repeat(4001) }).success).toBe(false);
});

test("applying a voice draft requires the MCP review confirmation", async () => {
  const context = { execute: () => "saved", refuse: () => "review required" };
  expect(await voiceApply.handler({}, context)).toBe("review required");
  expect(await voiceApply.handler({ confirm: false }, context)).toBe("review required");
  expect(await voiceApply.handler({ confirm: true }, context)).toBe("saved");
});
