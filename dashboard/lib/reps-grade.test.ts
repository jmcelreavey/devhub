import { describe, expect, it } from "vitest";
import { parseAiGradeText } from "./reps-grade";

describe("parseAiGradeText", () => {
  it("parses plain JSON", () => {
    expect(parseAiGradeText('{"caught":2,"missed":1,"missedSummary":"missed the PAT note"}')).toEqual({
      caught: 2,
      missed: 1,
      missedSummary: "missed the PAT note",
    });
  });

  it("parses JSON wrapped in prose and fences", () => {
    const text = 'Sure!\n```json\n{"caught": 0, "missed": 0, "missedSummary": ""}\n```';
    expect(parseAiGradeText(text)).toEqual({ caught: 0, missed: 0 });
  });

  it("strips empty missedSummary", () => {
    expect(parseAiGradeText('{"caught":3,"missed":0,"missedSummary":"  "}')).toEqual({
      caught: 3,
      missed: 0,
    });
  });

  it("throws on non-JSON and bad counts", () => {
    expect(() => parseAiGradeText("no json here")).toThrow("no JSON");
    expect(() => parseAiGradeText('{"caught":-1,"missed":0}')).toThrow("invalid counts");
    expect(() => parseAiGradeText('{"caught":"two","missed":0}')).toThrow("invalid counts");
  });
});
