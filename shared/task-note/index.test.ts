import { describe, it, expect } from "vitest";
import { buildTaskNoteMarkdown, taskNotePath } from "./index.ts";
import type { TaskNoteSource } from "./index.ts";

const task: TaskNoteSource = {
  id: "abc-123",
  text: "Ship note-from-task",
  date: "2026-07-28",
  jiraKey: "PTF-4313",
  jiraUrl: "https://example.atlassian.net/browse/PTF-4313",
};

describe("taskNotePath", () => {
  it("builds a stable path under task-notes/", () => {
    expect(taskNotePath(task)).toBe("task-notes/2026-07-28-abc-123");
  });
});

describe("buildTaskNoteMarkdown", () => {
  it("pre-fills header, jira link, taskRef backlink, and scaffold", () => {
    const md = buildTaskNoteMarkdown(task);
    expect(md).toContain("# Ship note-from-task");
    expect(md).toContain("**Date:** 2026-07-28");
    expect(md).toContain("**Jira:** [PTF-4313](https://example.atlassian.net/browse/PTF-4313)");
    expect(md).toContain("## Links");
    expect(md).toContain("::task-ref abc-123 2026-07-28 Ship note-from-task");
    expect(md).toContain("[Open in Work](/work?tab=tasks)");
    expect(md).toContain("## Notes");
    expect(md).toContain("## Action items");
  });

  it("omits jira line when absent", () => {
    const md = buildTaskNoteMarkdown({ ...task, jiraKey: undefined, jiraUrl: undefined });
    expect(md).not.toContain("**Jira:**");
  });
});
