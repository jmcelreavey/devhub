import fs from "node:fs";
import path from "node:path";
import { getDocsDir } from "@/lib/content/dirs";
import { parseFrontmatter, type DocFrontmatter } from "@/lib/docs/frontmatter";
import {
  inlineToPlainText,
  parseMarkdown,
  type DocNode,
  type DocOutboundLink,
  type InlineNode,
  type TocEntry,
} from "@/lib/docs/markdown-ast";
import {
  DOC_SECTIONS,
  getSectionMeta,
  ROOT_SECTION_ID,
  sectionIdForSlug,
  type DocSectionMeta,
} from "@/lib/docs/doc-sections";
import type {
  DocDetail,
  DocLinkRef,
  DocSectionGroup,
  DocSummary,
} from "@/lib/docs/doc-types";
import type { DocSearchSection } from "@/lib/docs/doc-search-types";

const WORDS_PER_MINUTE = 220;

interface RawDoc {
  slug: string;
  absPath: string;
  modified: number;
  frontmatter: DocFrontmatter;
  body: string;
  nodes: DocNode[];
  toc: TocEntry[];
  firstHeading: string | null;
  links: DocOutboundLink[];
  source: string;
}

export interface DocIndex {
  docs: DocSummary[];
  sections: DocSectionGroup[];
  /** Flattened nav order — the sequence prev/next walks. */
  ordered: DocSummary[];
  bySlug: Map<string, DocSummary>;
}

/* ------------------------------------------------------------------- cache */

export interface DocSearchEntry {
  sections: DocSearchSection[];
  /** Lowercased concatenation of every section, for frequency counting. */
  text: string;
}

interface CacheEntry {
  signature: string;
  raw: Map<string, RawDoc>;
  index: DocIndex;
  /** Built lazily — only search pays for it. */
  corpus?: Map<string, DocSearchEntry>;
}

let cache: CacheEntry | null = null;

function walkMarkdown(root: string, dir = ""): string[] {
  const abs = path.join(root, dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(root, rel));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

function signatureFor(root: string, files: string[]): string {
  const parts: string[] = [];
  for (const rel of files) {
    try {
      const stat = fs.statSync(path.join(root, rel));
      parts.push(`${rel}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return parts.join("|");
}

/* ------------------------------------------------------------------ titles */

function titleCase(segment: string): string {
  return segment
    .replace(/\.md$/i, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function deriveTitle(raw: RawDoc): string {
  if (raw.frontmatter.title) return raw.frontmatter.title;
  if (raw.firstHeading) return raw.firstHeading;
  const base = raw.slug.split("/").pop() ?? raw.slug;
  return base.toLowerCase() === "readme" ? titleCase(raw.slug.split("/")[0] || "Overview") : titleCase(base);
}

function deriveDescription(raw: RawDoc): string | undefined {
  if (raw.frontmatter.description) return raw.frontmatter.description;
  const index = leadParagraphIndex(raw.nodes);
  if (index === -1) return undefined;
  const node = raw.nodes[index];
  if (node.type !== "paragraph") return undefined;
  const text = inlineToPlainText(node.content).trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

/**
 * Index of the paragraph that acts as the doc's lede, or -1.
 *
 * Only the paragraph directly after a leading H1 counts. Grabbing "the first
 * paragraph anywhere" produced summaries lifted from halfway down the page,
 * which is worse than no summary at all.
 */
function leadParagraphIndex(nodes: DocNode[]): number {
  const start = nodes[0]?.type === "heading" && nodes[0].level === 1 ? 1 : 0;
  const node = nodes[start];
  if (!node || node.type !== "paragraph") return -1;
  return inlineToPlainText(node.content).trim().length >= 12 ? start : -1;
}

/**
 * Drop the parts of the body the page chrome already shows.
 *
 * Every doc opens with `# Title` and a one-line summary; the article header
 * renders both. Leaving them in the body means every doc reads its own title
 * twice before it says anything.
 */
function stripRedundantLead(raw: RawDoc, _title: string, description?: string): DocNode[] {
  let nodes = raw.nodes;
  // Always drop a leading H1. The page header renders the title unconditionally,
  // so keeping it would show the title twice — and matching on text equality
  // instead just made the behaviour depend on whether the frontmatter title
  // happened to use the same capitalisation as the heading.
  const first = nodes[0];
  if (first?.type === "heading" && first.level === 1) {
    nodes = nodes.slice(1);
  }
  // Only strip the lede when it *is* the description — a frontmatter
  // description is additive, so the paragraph still belongs in the body.
  if (!raw.frontmatter.description && description) {
    const next = nodes[0];
    if (next?.type === "paragraph") {
      const text = inlineToPlainText(next.content).trim();
      const matches = description.endsWith("…")
        ? text.startsWith(description.slice(0, -1))
        : text === description;
      if (matches) nodes = nodes.slice(1);
    }
  }
  return nodes;
}

function countWords(nodes: DocNode[]): number {
  let total = 0;
  const walk = (list: DocNode[]) => {
    for (const node of list) {
      switch (node.type) {
        case "heading":
        case "paragraph":
          total += inlineToPlainText(node.content).split(/\s+/).filter(Boolean).length;
          break;
        case "list":
          for (const item of node.items) {
            total += inlineToPlainText(item.content).split(/\s+/).filter(Boolean).length;
            walk(item.children);
          }
          break;
        case "code":
          total += node.value.split(/\s+/).filter(Boolean).length;
          break;
        case "blockquote":
        case "callout":
          walk(node.children);
          break;
        case "table":
          for (const row of node.rows) {
            for (const cell of row) total += inlineToPlainText(cell).split(/\s+/).filter(Boolean).length;
          }
          break;
        default:
          break;
      }
    }
  };
  walk(nodes);
  return total;
}

/* ------------------------------------------------------------------- build */

function readRawDocs(root: string, files: string[]): Map<string, RawDoc> {
  const map = new Map<string, RawDoc>();
  for (const rel of files) {
    const abs = path.join(root, rel);
    let source: string;
    let modified = 0;
    try {
      source = fs.readFileSync(abs, "utf8");
      modified = fs.statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(source);
    const parsed = parseMarkdown(body);
    const slug = rel.replace(/\.md$/i, "");
    map.set(slug, {
      slug,
      absPath: abs,
      modified,
      frontmatter,
      body,
      source,
      nodes: parsed.nodes,
      toc: parsed.toc,
      firstHeading: parsed.firstHeading,
      links: parsed.links,
    });
  }
  return map;
}

function toSummary(raw: RawDoc): DocSummary {
  const words = countWords(raw.nodes);
  return {
    slug: raw.slug,
    href: `/docs/${raw.slug}`,
    title: deriveTitle(raw),
    description: deriveDescription(raw),
    section: raw.frontmatter.section ?? sectionIdForSlug(raw.slug),
    order: raw.frontmatter.order,
    tags: raw.frontmatter.tags ?? [],
    draft: raw.frontmatter.draft ?? false,
    icon: raw.frontmatter.icon,
    modified: raw.modified,
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

function compareDocs(a: DocSummary, b: DocSummary): number {
  const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  // README/index docs lead their folder regardless of alphabetical order.
  const aIndex = isSectionIndex(a.slug) ? 0 : 1;
  const bIndex = isSectionIndex(b.slug) ? 0 : 1;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return a.title.localeCompare(b.title);
}

function isSectionIndex(slug: string): boolean {
  const base = (slug.split("/").pop() ?? "").toLowerCase();
  return base === "readme" || base === "index" || base === "overview";
}

function buildIndex(raws: Map<string, RawDoc>): DocIndex {
  const docs = [...raws.values()].map(toSummary);
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

  const grouped = new Map<string, DocSummary[]>();
  for (const doc of docs) {
    const list = grouped.get(doc.section) ?? [];
    list.push(doc);
    grouped.set(doc.section, list);
  }

  const sectionOrder = new Map(DOC_SECTIONS.map((s) => [s.id, s.order]));
  const sections: DocSectionGroup[] = [...grouped.entries()]
    .map(([id, list]) => ({ meta: getSectionMeta(id), docs: list.sort(compareDocs) }))
    .sort((a, b) => {
      const aOrder = a.meta.id === ROOT_SECTION_ID ? 0 : sectionOrder.get(a.meta.id) ?? a.meta.order;
      const bOrder = b.meta.id === ROOT_SECTION_ID ? 0 : sectionOrder.get(b.meta.id) ?? b.meta.order;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.meta.label.localeCompare(b.meta.label);
    });

  const ordered = sections.flatMap((section) => section.docs.filter((doc) => !doc.draft));

  return { docs, sections, ordered, bySlug };
}

function load(): CacheEntry {
  const root = getDocsDir();
  const files = walkMarkdown(root).sort();
  const signature = signatureFor(root, files);
  if (cache && cache.signature === signature) return cache;
  const raw = readRawDocs(root, files);
  const known = new Set(raw.keys());
  for (const doc of raw.values()) {
    rewriteDocLinks(doc.nodes, doc.slug, known);
  }
  cache = { signature, raw, index: buildIndex(raw) };
  return cache;
}

/**
 * Turn in-repo markdown links into app routes, in place.
 *
 * Docs are authored as a normal markdown tree (so they still read correctly on
 * GitHub and in an editor), which means links look like `../guides/theming.md`.
 * The rendered site needs `/docs/guides/theming`. Doing this once at index time
 * keeps the renderer dumb.
 */
function rewriteDocLinks(nodes: DocNode[], fromSlug: string, known: Set<string>): void {
  const walkInline = (inlines: InlineNode[]) => {
    for (const node of inlines) {
      if (node.type !== "link") continue;
      const [href, hash] = splitHash(node.href);
      const target = resolveDocSlug(href, fromSlug, known);
      if (target) node.href = `/docs/${target}${hash}`;
      walkInline(node.children);
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
      case "paragraph":
        walkInline(node.content);
        break;
      case "list":
        for (const item of node.items) {
          walkInline(item.content);
          rewriteDocLinks(item.children, fromSlug, known);
        }
        break;
      case "blockquote":
      case "callout":
        rewriteDocLinks(node.children, fromSlug, known);
        break;
      case "table":
        for (const cell of node.header) walkInline(cell);
        for (const row of node.rows) for (const cell of row) walkInline(cell);
        break;
      default:
        break;
    }
  }
}

function splitHash(href: string): [string, string] {
  const at = href.indexOf("#");
  if (at === -1) return [href, ""];
  return [href.slice(0, at), href.slice(at)];
}

/** Drop the memoised index. Call after any write to the docs tree. */
export function invalidateDocIndex(): void {
  cache = null;
}

export function getDocIndex(): DocIndex {
  return load().index;
}

/* ------------------------------------------------------------ link graph */

/**
 * Resolve a markdown href to a doc slug, or null when it points outside the
 * docs tree (external URLs, `../CONTRIBUTING.md`, in-page anchors).
 */
export function resolveDocSlug(href: string, fromSlug: string, known: Set<string>): string | null {
  if (!href) return null;
  const withoutHash = href.split("#")[0];
  if (!withoutHash) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutHash)) return null;

  let candidate = withoutHash;
  if (candidate.startsWith("/docs/")) {
    candidate = candidate.slice("/docs/".length);
  } else if (candidate.startsWith("/")) {
    return null;
  } else {
    const fromDir = fromSlug.includes("/") ? fromSlug.slice(0, fromSlug.lastIndexOf("/")) : "";
    candidate = path.posix.normalize(path.posix.join(fromDir, candidate));
  }

  if (candidate.startsWith("..")) return null;
  const slug = candidate.replace(/\.md$/i, "").replace(/\/$/, "");
  if (known.has(slug)) return slug;
  // Tolerate links to a folder that has an index doc.
  for (const suffix of ["README", "index", "overview"]) {
    if (known.has(`${slug}/${suffix}`)) return `${slug}/${suffix}`;
  }
  return null;
}

function toLinkRef(doc: DocSummary): DocLinkRef {
  return { slug: doc.slug, title: doc.title, href: doc.href, description: doc.description };
}

interface Graph {
  outbound: Map<string, string[]>;
  inbound: Map<string, string[]>;
}

function buildGraph(raws: Map<string, RawDoc>): Graph {
  const known = new Set(raws.keys());
  const outbound = new Map<string, string[]>();
  const inbound = new Map<string, string[]>();

  for (const raw of raws.values()) {
    const targets = new Set<string>();
    for (const link of raw.links) {
      const slug = resolveDocSlug(link.href, raw.slug, known);
      if (slug && slug !== raw.slug) targets.add(slug);
    }
    // Curated `related:` entries join the same graph, so they also produce
    // backlinks on the far side.
    for (const entry of raw.frontmatter.related ?? []) {
      const slug = resolveDocSlug(entry, raw.slug, known) ?? (known.has(entry) ? entry : null);
      if (slug && slug !== raw.slug) targets.add(slug);
    }
    outbound.set(raw.slug, [...targets]);
    for (const target of targets) {
      const list = inbound.get(target) ?? [];
      list.push(raw.slug);
      inbound.set(target, list);
    }
  }

  return { outbound, inbound };
}

/* ------------------------------------------------------------------ detail */

function breadcrumbsFor(slug: string, sectionId: string): Array<{ label: string; href?: string }> {
  const trail: Array<{ label: string; href?: string }> = [{ label: "Docs", href: "/docs" }];
  if (sectionId !== ROOT_SECTION_ID) {
    // Sections have their own page now, so the crumb navigates rather than
    // scrolling the landing page to an anchor that no longer exists.
    trail.push({ label: getSectionMeta(sectionId).label, href: `/docs/${sectionId}` });
  }
  const middle = slug.split("/").slice(1, -1);
  for (const part of middle) trail.push({ label: titleCase(part) });
  return trail;
}

/** Full render payload for one doc, or null when the slug does not exist. */
export function getDocDetail(slug: string): DocDetail | null {
  const entry = load();
  const raw = entry.raw.get(slug);
  if (!raw) return null;

  const { index } = entry;
  const summary = index.bySlug.get(slug);
  if (!summary) return null;

  const graph = buildGraph(entry.raw);
  const relatedSlugs = graph.outbound.get(slug) ?? [];
  const backlinkSlugs = graph.inbound.get(slug) ?? [];

  const related = relatedSlugs
    .map((s) => index.bySlug.get(s))
    .filter((d): d is DocSummary => Boolean(d) && !d!.draft)
    .map(toLinkRef);

  const backlinks = backlinkSlugs
    .map((s) => index.bySlug.get(s))
    .filter((d): d is DocSummary => Boolean(d) && !d!.draft)
    .map(toLinkRef)
    .sort((a, b) => a.title.localeCompare(b.title));

  const position = index.ordered.findIndex((doc) => doc.slug === slug);
  const prev = position > 0 ? toLinkRef(index.ordered[position - 1]) : null;
  const next =
    position !== -1 && position < index.ordered.length - 1
      ? toLinkRef(index.ordered[position + 1])
      : null;

  return {
    ...summary,
    nodes: stripRedundantLead(raw, summary.title, summary.description),
    toc: raw.toc,
    related,
    backlinks,
    prev,
    next,
    breadcrumbs: breadcrumbsFor(slug, summary.section),
    source: raw.source,
  };
}

/**
 * A section's own page: its docs, plus the neighbouring sections.
 *
 * Returns null for an unknown id so the doc route can fall through to "this is
 * a doc slug" without a section shadowing a real file.
 */
export function getSectionDetail(sectionId: string): {
  meta: DocSectionMeta;
  docs: DocSummary[];
  prev: DocSectionMeta | null;
  next: DocSectionMeta | null;
} | null {
  const index = getDocIndex();
  const position = index.sections.findIndex((section) => section.meta.id === sectionId);
  if (position === -1) return null;

  const group = index.sections[position];
  const docs = group.docs.filter((doc) => !doc.draft);
  if (docs.length === 0) return null;

  return {
    meta: group.meta,
    docs,
    prev: position > 0 ? index.sections[position - 1].meta : null,
    next: position < index.sections.length - 1 ? index.sections[position + 1].meta : null,
  };
}

/* ------------------------------------------------------------ search corpus */

/**
 * Flatten each doc into heading-scoped chunks of plain text.
 *
 * Chunking on headings rather than storing one blob per doc is what lets a
 * search result deep-link to the section it actually matched, instead of
 * dropping you at the top of a 300-line reference page.
 */
function buildSearchCorpus(raws: Map<string, RawDoc>): Map<string, DocSearchEntry> {
  const corpus = new Map<string, DocSearchEntry>();

  for (const raw of raws.values()) {
    const sections: DocSearchSection[] = [];
    let current: DocSearchSection = { heading: deriveTitle(raw), id: "", text: "" };

    const push = () => {
      current.text = current.text.replace(/\s+/g, " ").trim();
      if (current.text) sections.push(current);
    };

    const walk = (nodes: DocNode[]) => {
      for (const node of nodes) {
        switch (node.type) {
          case "heading":
            push();
            current = { heading: node.text, id: node.id, text: "" };
            break;
          case "paragraph":
            current.text += ` ${inlineToPlainText(node.content)}`;
            break;
          case "list":
            for (const item of node.items) {
              current.text += ` ${inlineToPlainText(item.content)}`;
              walk(item.children);
            }
            break;
          case "code":
            current.text += ` ${node.value}`;
            break;
          case "blockquote":
          case "callout":
            walk(node.children);
            break;
          case "table":
            for (const cell of node.header) current.text += ` ${inlineToPlainText(cell)}`;
            for (const row of node.rows) {
              for (const cell of row) current.text += ` ${inlineToPlainText(cell)}`;
            }
            break;
          default:
            break;
        }
      }
    };

    walk(raw.nodes);
    push();

    corpus.set(raw.slug, {
      sections,
      text: sections.map((s) => `${s.heading} ${s.text}`).join(" \n ").toLowerCase(),
    });
  }

  return corpus;
}

/** Heading-chunked plain text for every doc, memoised alongside the index. */
export function getDocSearchCorpus(): Map<string, DocSearchEntry> {
  const entry = load();
  entry.corpus ??= buildSearchCorpus(entry.raw);
  return entry.corpus;
}

/** Docs sorted by recency, for the landing page. */
export function getRecentDocs(limit = 5): DocSummary[] {
  return [...getDocIndex().docs]
    .filter((doc) => !doc.draft)
    .sort((a, b) => b.modified - a.modified)
    .slice(0, limit);
}
