/** Shared docs types. Client-safe — no `node:fs`, no parsing. */

import type { DocNode, TocEntry } from "@/lib/docs/markdown-ast";
import type { DocSectionMeta } from "@/lib/docs/doc-sections";

export interface DocLinkRef {
  slug: string;
  title: string;
  href: string;
  /** Short excerpt or description, when we have one. */
  description?: string;
}

/** Everything the nav needs about a doc, without its body. */
export interface DocSummary extends DocLinkRef {
  section: string;
  order?: number;
  tags: string[];
  draft: boolean;
  icon?: string;
  modified: number;
  readingMinutes: number;
}

export interface DocSectionGroup {
  meta: DocSectionMeta;
  docs: DocSummary[];
}

/** A doc plus everything needed to render its page. */
export interface DocDetail extends DocSummary {
  nodes: DocNode[];
  toc: TocEntry[];
  /** Docs this one links to (resolved, deduped, in-repo only). */
  related: DocLinkRef[];
  /** Docs that link here. */
  backlinks: DocLinkRef[];
  /** Ordered neighbours within the flattened nav. */
  prev: DocLinkRef | null;
  next: DocLinkRef | null;
  /** Folder trail for breadcrumbs, outermost first. */
  breadcrumbs: Array<{ label: string; href?: string }>;
  /** Raw markdown source, for the edit toggle. */
  source: string;
}
