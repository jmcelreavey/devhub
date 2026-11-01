/**
 * The trimmed shape the docs sidebar receives from the server layout.
 *
 * Kept separate from `DocSummary` so the layout only ships what the nav renders
 * — no reading times, tags, or mtimes crossing the server/client boundary on
 * every page load.
 */
export interface DocNavItem {
  slug: string;
  title: string;
  href: string;
  description?: string;
}

export interface DocNavGroup {
  id: string;
  label: string;
  secondary?: boolean;
  docs: DocNavItem[];
}
