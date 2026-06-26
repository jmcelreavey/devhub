import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/notes-ai/config", () => ({
  isNotesAiConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/ai-provider", () => ({
  getNotesAiModel: vi.fn(() => null),
  getNotesAiCallOptions: vi.fn(() => ({})),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

describe("briefing-ai (AI unconfigured — all fallbacks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateAiDevTip falls back to static rotation", async () => {
    const { generateAiDevTip } = await import("./briefing-ai");
    const tip = await generateAiDevTip(["typescript", "react"], new Date("2026-06-22"));
    expect(tip).not.toBeNull();
    expect(tip?.aiGenerated).toBeUndefined();
    expect(tip?.text.length).toBeGreaterThan(5);
  });

  it("generateAiDevTip falls back when techStack is empty", async () => {
    const { generateAiDevTip } = await import("./briefing-ai");
    const tip = await generateAiDevTip([], new Date());
    expect(tip).not.toBeNull();
  });

  it("generateAiSummary returns null when AI is unconfigured", async () => {
    const { generateAiSummary } = await import("./briefing-ai");
    const summary = await generateAiSummary(
      {
        weather: null, devTip: null, news: [], events: [],
        github: [], hackerNews: [], gaming: [], onThisDay: [],
        aiSummary: null, interestSnippets: [],
      },
      { techStack: ["typescript"], interests: ["F1"] },
    );
    expect(summary).toBeNull();
  });

  it("generateInterestSnippets returns empty array when AI is unconfigured", async () => {
    const { generateInterestSnippets } = await import("./briefing-ai");
    const snippets = await generateInterestSnippets(["F1", "space"]);
    expect(snippets).toEqual([]);
  });

  it("generateInterestSnippets returns empty when no interests", async () => {
    const { generateInterestSnippets } = await import("./briefing-ai");
    const snippets = await generateInterestSnippets([]);
    expect(snippets).toEqual([]);
  });
});
