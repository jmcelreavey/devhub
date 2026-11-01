import { describe, expect, it } from "vitest";
import { NOTE_TEMPLATES, newNoteMarkdown, noteTemplateById } from "./templates";

describe("newNoteMarkdown", () => {
  it("starts a blank note with a title from its name and no checkbox", () => {
    expect(newNoteMarkdown("scratch/fence-repair_notes")).toBe("# Fence repair notes\n\n");
  });
  it("titles templates from the note name, fills today's date and never scaffolds a checkbox", () => {
    const md = newNoteMarkdown("meetings/mobile-sync", noteTemplateById("meeting"), new Date("2026-10-16T12:00:00Z"));
    expect(md.startsWith("# Mobile sync\n")).toBe(true);
    expect(md).toContain("**Date:** 2026-10-16");
    for (const tpl of NOTE_TEMPLATES) expect(tpl.markdown).not.toContain("- [ ]");
  });
});
