import { describe, expect, it } from "vitest";
import {
  evaluateImplementReady,
  jiraDescriptionHasContent,
  noteHasPlanOrAcceptanceSection,
  noteOpenQuestions,
  sectionBodyHasContent,
  taskTextHasPrerequisiteTag,
} from "./implement-ready";

describe("sectionBodyHasContent", () => {
  it("rejects empty and scaffold placeholders", () => {
    expect(sectionBodyHasContent("")).toBe(false);
    expect(sectionBodyHasContent("- ")).toBe(false);
    expect(sectionBodyHasContent("- [ ] ")).toBe(false);
    expect(sectionBodyHasContent("ab")).toBe(false);
  });

  it("accepts real plan lines", () => {
    expect(sectionBodyHasContent("- Ship the ready gate API")).toBe(true);
    expect(sectionBodyHasContent("Wire MCP parity.")).toBe(true);
  });
});

describe("noteHasPlanOrAcceptanceSection", () => {
  it("requires a Plan or Acceptance heading with body", () => {
    expect(noteHasPlanOrAcceptanceSection(null)).toBe(false);
    expect(noteHasPlanOrAcceptanceSection("# Title\n\n## Notes\n\n- stuff\n")).toBe(false);
    expect(noteHasPlanOrAcceptanceSection("## Plan\n\n- \n")).toBe(false);
    expect(
      noteHasPlanOrAcceptanceSection("# T\n\n## Plan\n\n- Implement the ready checklist\n\n## Notes\n"),
    ).toBe(true);
    expect(
      noteHasPlanOrAcceptanceSection("## Acceptance criteria\n\nMust warn, not hard-block.\n"),
    ).toBe(true);
  });
});

describe("jiraDescriptionHasContent", () => {
  it("needs a non-trivial description", () => {
    expect(jiraDescriptionHasContent(null)).toBe(false);
    expect(jiraDescriptionHasContent("short")).toBe(false);
    expect(jiraDescriptionHasContent("Ship the P3 ready gate with warn mode.")).toBe(true);
  });
});

describe("taskTextHasPrerequisiteTag", () => {
  it("matches prerequisite / prereq / blocker tags", () => {
    expect(taskTextHasPrerequisiteTag("Land API #prerequisite")).toBe(true);
    expect(taskTextHasPrerequisiteTag("#blocker Fix auth first")).toBe(true);
    expect(taskTextHasPrerequisiteTag("Needs #prereq before implement")).toBe(true);
    expect(taskTextHasPrerequisiteTag("Normal task #urgent")).toBe(false);
  });
});

describe("evaluateImplementReady", () => {
  const base = {
    noteMarkdown: null as string | null,
    jiraDescriptionText: null as string | null,
    hasJiraKey: false,
    repoIds: [] as string[],
    openPrerequisiteBlockers: [] as Array<{ id: string; text: string; date?: string }>,
    hardBlock: false,
    notePath: "task-notes/2026-09-16-abc",
    taskDate: "2026-09-16",
  };

  it("warns (does not block) when items fail and hardBlock is off", () => {
    const result = evaluateImplementReady(base);
    expect(result.ok).toBe(false);
    expect(result.warn).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(["acceptance", "questions", "repo", "prerequisites"]);
    expect(result.items.find((i) => i.id === "acceptance")?.ok).toBe(false);
    expect(result.items.find((i) => i.id === "repo")?.ok).toBe(false);
    expect(result.items.find((i) => i.id === "prerequisites")?.ok).toBe(true);
    expect(result.items.find((i) => i.id === "acceptance")?.fixHref).toBeUndefined();
  });

  it("counts an existing note as the plan unless a plan section is required", () => {
    const withNote = { ...base, noteMarkdown: "# Task\n\n## Notes\n\n- ", repoIds: ["owner/repo"] };
    const loose = evaluateImplementReady(withNote).items.find((i) => i.id === "acceptance");
    expect(loose).toMatchObject({ ok: true, detail: "Task note exists", fixLabel: "Open task note" });
    expect(evaluateImplementReady({ ...withNote, requirePlanSection: true }).ok).toBe(false);
  });

  it("hard-blocks when the setting is on and items fail", () => {
    const result = evaluateImplementReady({ ...base, hardBlock: true });
    expect(result.blocked).toBe(true);
    expect(result.warn).toBe(false);
  });

  it("passes acceptance via note plan or Jira description", () => {
    expect(
      evaluateImplementReady({
        ...base,
        noteMarkdown: "## Plan\n\n- Do the thing carefully\n",
        repoIds: ["owner/repo"],
      }).ok,
    ).toBe(true);

    expect(
      evaluateImplementReady({
        ...base,
        hasJiraKey: true,
        jiraDescriptionText: "Long enough Jira description body.",
        repoIds: ["owner/repo"],
      }).ok,
    ).toBe(true);
  });

  it("requires a single repo or an explicit modal pick", () => {
    const multi = evaluateImplementReady({
      ...base,
      noteMarkdown: "## Acceptance\n\nReady to go now.\n",
      repoIds: ["a/one", "b/two"],
    });
    expect(multi.ok).toBe(false);
    expect(multi.selectedRepoId).toBeNull();

    const picked = evaluateImplementReady({
      ...base,
      noteMarkdown: "## Acceptance\n\nReady to go now.\n",
      repoIds: ["a/one", "b/two"],
      selectedRepoId: "b/two",
    });
    expect(picked.ok).toBe(true);
    expect(picked.selectedRepoId).toBe("b/two");
  });

  it("treats hubRepoId as the repo when links are empty", () => {
    const result = evaluateImplementReady({
      ...base,
      noteMarkdown: "## Plan\n\n- Ship it\n",
      hubRepoId: "owner/from-hub",
    });
    expect(result.ok).toBe(true);
    expect(result.selectedRepoId).toBe("owner/from-hub");
  });

  it("fails when an open prerequisite/blocker remains", () => {
    const result = evaluateImplementReady({
      ...base,
      noteMarkdown: "## Plan\n\n- Ship it\n",
      repoIds: ["owner/repo"],
      openPrerequisiteBlockers: [{ id: "pre-1", text: "Land auth #prerequisite", date: "2026-09-15" }],
    });
    expect(result.ok).toBe(false);
    expect(result.items.find((i) => i.id === "prerequisites")?.ok).toBe(false);
    expect(result.items.find((i) => i.id === "prerequisites")?.fixHref).toContain("2026-09-15");
  });
});

describe("noteOpenQuestions", () => {
  it("returns unanswered questions only", () => {
    const md = "## Plan\n- Do it\n\n## Open questions\n- [ ] Which env?\n- [x] Who owns it?\n- \n- Is there a flag?\n\n## Notes\n- other";
    expect(noteOpenQuestions(md)).toEqual(["Which env?", "Is there a flag?"]);
    expect(noteOpenQuestions("## Open questions\n\n- [ ] ")).toEqual([]);
    expect(noteOpenQuestions(null)).toEqual([]);
  });

  it("keeps a task with open questions out of ready", () => {
    const result = evaluateImplementReady({
      noteMarkdown: "## Plan\nTighten the timeout.\n\n## Open questions\n- [ ] Which env?",
      jiraDescriptionText: null,
      hasJiraKey: false,
      repoIds: ["acme/app"],
      openPrerequisiteBlockers: [],
      hardBlock: true,
    });
    expect(result.ok).toBe(false);
    expect(result.items.find((i) => i.id === "questions")).toMatchObject({ ok: false, detail: "Which env?" });
  });
});
