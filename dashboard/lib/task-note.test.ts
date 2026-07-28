import { describe, it, expect } from "vitest";
import { buildTaskNoteMarkdown, taskNotePath } from "./task-note";

describe("taskNotePath", () => {
  it("builds a stable path under task-notes/", () => {
    expect(
      taskNotePath({ id: "abc-123", text: "Hello", date: "2026-07-28" }),
    ).toBe("task-notes/2026-07-28-abc-123");
  });
});

describe("buildTaskNoteMarkdown", () => {
  it("includes a taskRef backlink", () => {
    const md = buildTaskNoteMarkdown({
      id: "abc-123",
      text: "Hello",
      date: "2026-07-28",
    });
    expect(md).toContain("::task-ref abc-123 2026-07-28 Hello");
  });
});
