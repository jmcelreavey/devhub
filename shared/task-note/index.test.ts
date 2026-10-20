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
  it("pre-fills the metadata block, taskRef backlink, and scaffold", () => {
    const md = buildTaskNoteMarkdown(task);
    expect(md).toContain("# Ship note-from-task");
    expect(md).toContain("```task-meta");
    expect(md).toContain('"date": "2026-07-28"');
    expect(md).toContain('"href": "https://example.atlassian.net/browse/PTF-4313"');
    expect(md).toContain('"label": "Open in Work"');
    expect(md).toContain("::task-ref abc-123 2026-07-28 Ship note-from-task");
    expect(md).not.toContain("## Links");
    expect(md).not.toContain("**Date:**");
    expect(md).toContain("## Notes");
    expect(md).not.toContain("- [ ]");
  });

  it("omits jira line when absent", () => {
    const md = buildTaskNoteMarkdown({ ...task, jiraKey: undefined, jiraUrl: undefined });
    expect(md).not.toContain('"kind": "jira"');
  });
});

describe("normalizeTaskLinkState", () => {
  it("keeps PTF-4891 as parent context, but still promotes a real child link", () => {
    const parent = { kind: "jira" as const, id: "PTF-4891", label: "Parent PTF-4891", href: "https://jira.example.test/browse/PTF-4891" };
    expect(normalizeTaskLinkState("Android login", undefined, [parent], "PTF-4891")).toEqual({ text: "Android login", jiraKey: undefined, links: [parent] });
    const child = { kind: "jira" as const, id: "PTF-5271", label: "PTF-5271" };
    expect(normalizeTaskLinkState("Android login", undefined, [parent, child], "PTF-4891")).toMatchObject({ jiraKey: "PTF-5271", text: "PTF-5271 Android login" });
  });
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
