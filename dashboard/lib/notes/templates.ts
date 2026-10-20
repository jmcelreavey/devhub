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
      "- ",
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
      "- ",
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
      "- ",
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
      "- ",
    ].join("\n"),
  },
];

export function noteTemplateById(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id);
}

/** "scratch/fence-repair_notes" → "Fence repair notes". */
export function noteTitleFromPath(path: string): string {
  const base = path.split("/").filter(Boolean).pop() ?? "";
  const words = base.replace(/\.json$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled";
}

/**
 * Markdown a new note starts with, in John's usual shape: an H1 title from the
 * note name, then the template body. Blank notes get just the title and an empty
 * line to write the summary into. `**Date:**` fields are filled with today.
 */
export function newNoteMarkdown(path: string, template?: NoteTemplate, today = new Date()): string {
  const title = noteTitleFromPath(path);
  if (!template) return `# ${title}\n\n`;
  const date = today.toISOString().slice(0, 10);
  const lines = template.markdown.split("\n");
  if (lines[0]?.startsWith("# ")) lines[0] = template.id === "rfc" ? `# RFC: ${title}` : `# ${title}`;
  return lines.map((line) => (line === "**Date:** " ? `**Date:** ${date}` : line)).join("\n");
}

