/**
 * Starter scaffolds offered when creating a new note. Edit the markdown here to
 * change a template — it is converted to BlockNote blocks via `textToBlocks`.
 */
export interface NoteTemplate {
  id: string;
  label: string;
  markdown: string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "meeting",
    label: "Meeting",
    markdown: [
      "# Meeting",
      "",
      "**Date:** ",
      "**Attendees:** ",
      "",
      "## Agenda",
      "",
      "- ",
      "",
      "## Notes",
      "",
      "- ",
      "",
      "## Action items",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "one-on-one",
    label: "1:1",
    markdown: [
      "# 1:1",
      "",
      "**Date:** ",
      "**With:** ",
      "",
      "## Talking points",
      "",
      "- ",
      "",
      "## Feedback",
      "",
      "- ",
      "",
      "## Follow-ups",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "incident",
    label: "Incident",
    markdown: [
      "# Incident",
      "",
      "**Status:** Investigating",
      "**Started:** ",
      "**Severity:** ",
      "",
      "## Summary",
      "",
      "## Timeline",
      "",
      "- ",
      "",
      "## Impact",
      "",
      "## Root cause",
      "",
      "## Action items",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "rfc",
    label: "RFC",
    markdown: [
      "# RFC: ",
      "",
      "**Author:** ",
      "**Status:** Draft",
      "",
      "## Context",
      "",
      "## Proposal",
      "",
      "## Alternatives considered",
      "",
      "## Risks",
      "",
      "## Open questions",
      "",
      "- ",
    ].join("\n"),
  },
  {
    id: "retro",
    label: "Retro",
    markdown: [
      "# Retro",
      "",
      "**Date:** ",
      "",
      "## What went well",
      "",
      "- ",
      "",
      "## What didn't",
      "",
      "- ",
      "",
      "## Action items",
      "",
      "- [ ] ",
    ].join("\n"),
  },
];

export function noteTemplateById(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id);
}
