import { describe, expect, it } from "vitest";
import { teamContextSections } from "./context";

describe("team context presentation", () => {
  it("labels the card sections without changing the plain handoff note", () => {
    const sections = ["APP-42 Keep saved articles available offline", "Ticket: APP-42", "Summary: Keep saved articles on the device.", "Summary: Ready\nWhat changed: Added a cache\nState: Waiting\nNext steps: Confirm retention", "Plan: Add an offline article cache.", "Last run: Cache implementation complete.", "Branch: devhub/app-42-offline-cache", "PR: https://github.com/acme/app/pull/42", "Question: Keep cached articles for seven days?"];
    const note = sections.join("\n\n");
    const formatted = teamContextSections(sections);
    expect(formatted[0]).toBe("*Task*\n" + sections[0]);
    for (const label of ["Ticket", "Summary", "What changed", "State", "Next steps", "Plan", "Last run", "Branch", "PR", "Question"]) expect(formatted.join("\n")).toContain("*" + label + "*\n");
    expect(sections.join("\n\n")).toBe(note);
    expect(note).not.toContain("*Task*");
    expect(formatted.slice(1).map((section) => section.replace(/^\*([^*]+)\*\n/gm, "$1: "))).toEqual(sections.slice(1));
  });
});
