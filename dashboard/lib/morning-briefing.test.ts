import { describe, it, expect } from "vitest";
import { buildBriefingPrompt, briefingIsEmpty, type BriefingInput } from "./morning-briefing";

const EMPTY: BriefingInput = {
  date: "2026-05-30",
  events: [],
  staleTickets: [],
  prsToReview: [],
  oncallAlerts: [],
  topTasks: [],
};

describe("briefingIsEmpty", () => {
  it("is true when there is no signal", () => {
    expect(briefingIsEmpty(EMPTY)).toBe(true);
  });
  it("is false with any signal", () => {
    expect(briefingIsEmpty({ ...EMPTY, topTasks: [{ text: "ship it" }] })).toBe(false);
  });
});

describe("buildBriefingPrompt", () => {
  it("includes the date and labels empty sections as none", () => {
    const prompt = buildBriefingPrompt(EMPTY);
    expect(prompt).toContain("2026-05-30");
    expect(prompt).toContain("Meetings today: none");
    expect(prompt).toContain("Overnight on-call alerts: none");
  });

  it("lists provided facts under their sections", () => {
    const prompt = buildBriefingPrompt({
      ...EMPTY,
      events: [{ time: "10:00", title: "Standup" }],
      prsToReview: [{ title: "Add caching", repo: "foo/bar" }],
      oncallAlerts: [{ title: "DLQ growing" }],
      topTasks: [{ text: "Fix login" }],
    });
    expect(prompt).toContain("- 10:00 Standup");
    expect(prompt).toContain("- Add caching (foo/bar)");
    expect(prompt).toContain("- DLQ growing");
    expect(prompt).toContain("- Fix login");
  });
});
