/**
 * Section metadata for the docs site.
 *
 * Sections are derived from the top-level folder under `docs/` so the
 * filesystem stays the source of truth. This table only adds the things a
 * folder name cannot carry: a human label, an ordering, a one-line summary, and
 * an icon. Unknown folders still render — they just get a title-cased label and
 * sort to the end.
 *
 * Client-safe: no `node:fs`.
 */

export interface DocSectionMeta {
  id: string;
  label: string;
  description: string;
  /** Lucide icon name, resolved by the landing page. */
  icon: string;
  order: number;
  /** Collapsed by default in the sidebar and demoted on the landing page. */
  secondary?: boolean;
}

export const DOC_SECTIONS: DocSectionMeta[] = [
  {
    id: "getting-started",
    label: "Getting started",
    description: "Install DevHub, point it at your repo, and get the dashboard running.",
    icon: "Rocket",
    order: 10,
  },
  {
    id: "architecture",
    label: "Architecture",
    description: "How the dashboard, sync engine, MCP server and desktop shell fit together.",
    icon: "Blocks",
    order: 20,
  },
  {
    id: "guides",
    label: "Guides",
    description: "Task-shaped walkthroughs for the things you actually do day to day.",
    icon: "Map",
    order: 30,
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Connecting Jira, GitHub, Datadog, Google Calendar and Figma.",
    icon: "Plug",
    order: 40,
  },
  {
    id: "reference",
    label: "Reference",
    description: "API routes, scripts, environment variables — the lookup tables.",
    icon: "Library",
    order: 50,
  },
  {
    id: "archive",
    label: "Archive",
    description: "Finished plans and point-in-time audits, kept for provenance.",
    icon: "Archive",
    order: 90,
    secondary: true,
  },
];

const BY_ID = new Map(DOC_SECTIONS.map((section) => [section.id, section]));

/** Root-level docs (no folder) group under this pseudo-section. */
export const ROOT_SECTION_ID = "overview";

export const ROOT_SECTION: DocSectionMeta = {
  id: ROOT_SECTION_ID,
  label: "Overview",
  description: "Start here.",
  icon: "BookOpen",
  order: 0,
};

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getSectionMeta(id: string): DocSectionMeta {
  if (id === ROOT_SECTION_ID) return ROOT_SECTION;
  const known = BY_ID.get(id);
  if (known) return known;
  return {
    id,
    label: titleCase(id),
    description: "",
    icon: "Folder",
    order: 80,
  };
}

/** Section id for a doc slug like `guides/theming`. */
export function sectionIdForSlug(slug: string): string {
  const parts = slug.split("/");
  return parts.length > 1 ? parts[0] : ROOT_SECTION_ID;
}
