import { describe, expect, it } from "vitest";
import {
  buildLearningQuery,
  formatContextPackMarkdown,
  type ContextPack,
} from "./context-pack";

function pack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    generatedAt: "2026-06-05T12:00:00.000Z",
    today: "2026-06-05",
    openTasks: [{ id: "1", text: "Ship feature", due: "2026-06-05" }],
    recentLearnings: [{ category: "tools/vim", title: "Vim tips", preview: "use ciw" }],
    learningSelection: "relevant",
    learningQuery: "Ship feature",
    dailyNotePath: "daily/2026-06-05",
    dailyNotePreview: "Morning standup",
    standupMarkdown: null,
    ...overrides,
  };
}

describe("formatContextPackMarkdown", () => {
  it("formats tasks and learnings", () => {
    const md = formatContextPackMarkdown(pack());
    expect(md).toContain("Ship feature");
    expect(md).toContain("Vim tips");
  });

  it("claims relevance only when the learnings were actually ranked", () => {
    expect(formatContextPackMarkdown(pack())).toContain("## Learnings relevant to today");
  });

  it("says so when it fell back for want of a query", () => {
    // The pack is pasted into an agent. A silent fallback would read as the
    // stronger claim, so the degraded case has to announce itself.
    const md = formatContextPackMarkdown(
      pack({ learningSelection: "recent-no-query", learningQuery: null }),
    );
    expect(md).toContain("## Recent learnings");
    expect(md).toContain("most recent rather than the most relevant");
    expect(md).not.toContain("relevant to today");
  });

  it("says so when recall returned nothing", () => {
    const md = formatContextPackMarkdown(pack({ learningSelection: "recent-no-index" }));
    expect(md).toContain("Recall returned no matches");
  });

  it("still renders when there are no learnings at all", () => {
    const md = formatContextPackMarkdown(pack({ recentLearnings: [] }));
    expect(md).toContain("- (none)");
  });
});

describe("buildLearningQuery", () => {
  it("combines task text, Jira keys and the daily note", () => {
    const query = buildLearningQuery(
      [{ text: "Fix the cache purge", jiraKey: "PTF-3774" }],
      "Looking at invalidation again",
    );
    expect(query).toContain("Fix the cache purge");
    expect(query).toContain("PTF-3774");
    expect(query).toContain("invalidation");
  });

  it("includes the Jira key separately from the text that mentions it", () => {
    // recall extracts entity refs from the query and scores chunks sharing them,
    // so the bare key has to appear as its own term, not only inside prose.
    const query = buildLearningQuery([{ text: "PTF-3774 rollout", jiraKey: "PTF-3774" }], null);
    expect(query.match(/PTF-3774/g)).toHaveLength(2);
  });

  it("is empty when there is nothing to be relevant to", () => {
    expect(buildLearningQuery([], null)).toBe("");
    expect(buildLearningQuery([], "   ")).toBe("");
  });

  it("ignores blank task text without dropping the Jira key", () => {
    expect(buildLearningQuery([{ text: "   ", jiraKey: "ABC-1" }], null)).toBe("ABC-1");
  });

  it("truncates the daily note so prose cannot swamp the task terms", () => {
    const long = "x".repeat(2000);
    const query = buildLearningQuery([{ text: "task", jiraKey: undefined }], long);
    expect(query.length).toBeLessThan(700);
    expect(query.startsWith("task ")).toBe(true);
  });
});
