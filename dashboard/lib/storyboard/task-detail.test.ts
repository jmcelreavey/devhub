import { describe, expect, it } from "vitest";
import { sectionForTaskAction, taskDetailHref, taskDetailSection } from "./task-detail";
import type { NextAction } from "./next-action";

describe("task detail URL and section", () => {
  it("keeps filters, inbox, older-done selection and the legacy hash", () => {
    expect(taskDetailHref("/storyboard", "repo=app&jira=APP-42&done=all&inbox=1", "task one", "answer", "#task-note-questions"))
      .toBe("/storyboard?repo=app&jira=APP-42&done=all&inbox=1&task=task+one&taskSection=answer#task-note-questions");
  });
  it("replaces only the selected task and discards an old explicit section", () => {
    expect(taskDetailHref("/", "task=old&taskSection=note&tag=ux", "new")).toBe("/?task=new&tag=ux");
  });
  it("accepts known sections only", () => {
    expect(taskDetailSection("evidence")).toBe("evidence");
    expect(taskDetailSection("invented")).toBeUndefined();
  });
  it.each([
    ["answer", "answer"], ["choose-repo", "repo"], ["progress", "activity"], ["clear", "activity"],
    ["review", "evidence"], ["review-proposal", "evidence"], ["retry", "evidence"],
    ["auto-retry", "evidence"], ["finish", "controls"], ["done", "controls"], ["start-auto", "plan"],
  ] as const)("opens %s at %s", (kind, section) => {
    expect(sectionForTaskAction({ kind } as NextAction)).toBe(section);
  });
});
