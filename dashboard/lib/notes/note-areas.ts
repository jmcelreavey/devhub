/**
 * Area metadata for the notes vault.
 *
 * Areas are the top-level folders under `notes/`. As with docs sections, the
 * filesystem stays the source of truth and this table only adds what a folder
 * name cannot carry: a human label, a summary, an icon and an ordering.
 *
 * Unknown folders still render — they get a title-cased label and sort last, so
 * a new folder appears in the UI the moment it has a file in it.
 *
 * Client-safe: no `node:fs`.
 */

export interface NoteAreaMeta {
  id: string;
  label: string;
  description: string;
  /** Lucide icon name, resolved through the shared docs icon allowlist. */
  icon: string;
  order: number;
  /** Collapsed by default in the sidebar and demoted on the landing page. */
  secondary?: boolean;
}

export const NOTE_AREAS: NoteAreaMeta[] = [
  {
    id: "daily",
    label: "Daily",
    description: "Day-by-day working notes and standups.",
    icon: "Calendar",
    order: 10,
  },
  {
    id: "learnings",
    label: "Learnings",
    description: "Reusable knowledge distilled out of the day-to-day.",
    icon: "Sparkles",
    order: 20,
  },
  {
    id: "sessions",
    label: "Sessions",
    description: "Longer records of significant AI-assisted work.",
    icon: "Bot",
    order: 30,
  },
  {
    id: "meetings",
    label: "Meetings",
    description: "Meeting notes and follow-ups.",
    icon: "Users",
    order: 40,
  },
  {
    id: "task-notes",
    label: "Task notes",
    description: "Notes linked to a specific task.",
    icon: "ListTodo",
    order: 45,
  },
  {
    id: "reviews",
    label: "Reviews",
    description: "Code and DX reviews, and their findings.",
    icon: "Award",
    order: 50,
  },
  {
    id: "pr-reviews",
    label: "PR reviews",
    description: "Generated review notes, one per pull request.",
    icon: "GitPullRequest",
    order: 60,
    secondary: true,
  },
  {
    id: "research",
    label: "Research",
    description: "Longer-form digging into a topic.",
    icon: "Compass",
    order: 70,
  },
  {
    id: "garden",
    label: "Garden",
    description: "Notes still growing — half-formed, kept on purpose.",
    icon: "NotebookPen",
    order: 80,
  },
  {
    id: "diagrams",
    label: "Diagrams",
    description: "tldraw canvases for visual thinking.",
    icon: "PenTool",
    order: 90,
  },
  {
    id: "radar",
    label: "Radar",
    description: "Capability radar scans and digests.",
    icon: "Activity",
    order: 100,
  },
  {
    id: "archive",
    label: "Archive",
    description: "Kept for provenance, not for reading.",
    icon: "Archive",
    order: 200,
    secondary: true,
  },
];

const BY_ID = new Map(NOTE_AREAS.map((area) => [area.id, area]));

/** Notes sitting directly under `notes/` group here. */
export const ROOT_AREA_ID = "inbox";

export const ROOT_AREA: NoteAreaMeta = {
  id: ROOT_AREA_ID,
  label: "Inbox",
  description: "Loose notes that have not been filed into an area yet.",
  icon: "FileText",
  order: 0,
};

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getAreaMeta(id: string): NoteAreaMeta {
  if (id === ROOT_AREA_ID) return ROOT_AREA;
  const known = BY_ID.get(id);
  if (known) return known;
  return { id, label: titleCase(id), description: "", icon: "Folder", order: 150 };
}

/** Area id for a note slug like `daily/2026-07-27`. */
export function areaIdForSlug(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? parts[0] : ROOT_AREA_ID;
}
