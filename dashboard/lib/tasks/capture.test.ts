import { describe, expect, it } from "vitest";
import { buildCaptureSection, captureKeywords } from "@/lib/tasks/capture";

describe("captureKeywords", () => {
  it("puts a Jira key first, then the longest meaningful words", () => {
    expect(captureKeywords("PTF-123 investigate why the service foo returns 500s")).toEqual([
      "ptf-123",
      "service",
      "returns",
    ]);
  });

  it("ignores links, short words and filler", () => {
    expect(captureKeywords("check https://example.com/some/long/path maybe later")).toEqual(["later"]);
    expect(captureKeywords("fix it")).toEqual([]);
  });
});

describe("buildCaptureSection", () => {
  it("lists what was found and leaves an open-questions scaffold", () => {
    const md = buildCaptureSection("Alert fired twice", {
      notes: [{ path: "learnings/foo", excerpt: "foo timeouts" }],
      prs: [{ url: "https://github.com/acme/app/pull/1", title: "Tighten timeout", repo: "acme/app" }],
      tasks: [{ text: "Look at foo", date: "2026-09-01", state: "done" }],
      alerts: [],
    });
    expect(md).toContain("## Captured\n\nAlert fired twice");
    expect(md).toContain("- Note [learnings/foo](/notes/learnings/foo) — foo timeouts");
    expect(md).toContain("- PR [acme/app: Tighten timeout](https://github.com/acme/app/pull/1)");
    expect(md).toContain("- Related task (2026-09-01, done): Look at foo");
    expect(md).toContain("## Open questions");
  });

  it("says so when nothing related was found", () => {
    expect(buildCaptureSection(undefined, { notes: [], prs: [], tasks: [], alerts: [] })).toContain(
      "Nothing related found at capture time.",
    );
  });
});
