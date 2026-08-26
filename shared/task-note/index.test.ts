import { describe, it, expect } from "vitest";
import { buildTaskNoteMarkdown, normalizeTaskLinkState, taskNotePath } from "./index.ts";
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

describe("normalizeTaskLinkState", () => {
  it("dedupes links and promotes jiraKey when unset", () => {
    const out = normalizeTaskLinkState("PR 3: Acme comments count", null, [
      {
        kind: "jira",
        id: "https://example.atlassian.net/browse/PTF-4783",
        label: "PTF-4783",
        href: "https://example.atlassian.net/browse/PTF-4783",
      },
      { kind: "jira", id: "PTF-4783", label: "PTF-4783", href: "https://example.atlassian.net/browse/PTF-4783" },
      { kind: "note", id: "WebView implementation plan", label: "WebView implementation plan" },
      {
        kind: "note",
        id: "projects/demo-app-article-screen-native-chrome-plan",
        label: "WebView implementation plan",
      },
    ]);
    expect(out.jiraKey).toBe("PTF-4783");
    expect(out.text.startsWith("PTF-4783")).toBe(true);
    expect(out.links?.filter((l) => l.kind === "jira")).toHaveLength(1);
    expect(out.links?.filter((l) => l.kind === "note")).toHaveLength(1);
    expect(out.links?.find((l) => l.kind === "note")?.id).toBe(
      "projects/demo-app-article-screen-native-chrome-plan",
    );
  });

  it("does not change an existing jiraKey", () => {
    const out = normalizeTaskLinkState("BAR-1 already linked", "BAR-1", [
      { kind: "jira", id: "ZZZ-9", label: "ZZZ-9" },
    ]);
    expect(out.jiraKey).toBe("BAR-1");
    expect(out.text).toBe("BAR-1 already linked");
  });
});

