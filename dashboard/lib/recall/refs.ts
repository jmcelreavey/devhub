/**
 * Derived entity extraction — the half of the graph nobody has to type.
 *
 * `entity-links` already resolves edges, but only where a human created a note
 * from a template and filled in a `## Links` section. That means a Jira key
 * sitting in a branch name, a commit message, a PR title and three notes
 * produces exactly zero edges today.
 *
 * This module reads those references straight out of text. Everything it emits
 * uses the same `EntityRef` contract as hand-written links, so downstream code
 * (EntityLinkChips, the relations panel, MCP) cannot tell the difference — and
 * shouldn't have to.
 *
 * Precision over recall is the rule here. A false edge is worse than a missing
 * one: it pollutes every future retrieval that touches either endpoint. Hence
 * full 40-char SHAs only, and no bare-number "issue" matching.
 */
import { entityKey, type EntityRef } from "@/lib/entity-note";

/** `PTF-3774`. Global variant of `JIRA_KEY_RE` from lib/utils. */
const JIRA_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;

/** `owner/repo#123` — the unambiguous cross-repo PR form. */
const PR_SHORT_RE = /\b([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d{1,7})\b/g;

/** A GitHub PR or issue URL. */
const PR_URL_RE =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d{1,7})/g;

/**
 * Full commit SHAs only. Short SHAs (`a1b2c3d`) are indistinguishable from
 * hex colours, hashes, and half the ids in a BlockNote document, and matching
 * them produced ~40 junk entities per note in testing.
 */
const SHA_RE = /\b([0-9a-f]{40})\b/g;

/** `[[some/note/path]]` — wiki link, and `notes/foo/bar` paths. */
const WIKILINK_RE = /\[\[([^\]|]{1,160})\]\]/g;

/** The `::task-ref <id> <date> <label>` marker the vault already writes. */
const TASK_MARKER_RE = /::task-ref\s+([\w-]+)/g;

/** `@repo-name` explicit repo callout, plus bare `owner/repo` in event meta. */
const REPO_SLUG_RE = /\b([A-Za-z0-9][\w.-]*\/[\w.-]+)\b(?!#)/g;

export interface ExtractRefsOptions {
  /**
   * Also match bare `owner/repo` slugs. Off by default because file paths
   * (`lib/recall/refs.ts`) match the same shape; on for event metadata where
   * the field genuinely holds a repo.
   */
  includeRepoSlugs?: boolean;
  /** Cap on refs returned, guarding against a pathological document. */
  limit?: number;
}

function push(map: Map<string, EntityRef>, ref: EntityRef): void {
  const key = entityKey(ref);
  if (!map.has(key)) map.set(key, ref);
}

/**
 * Pull every entity reference out of a blob of text.
 *
 * Deduplicated by `entityKey`, insertion-ordered so the first mention wins its
 * label. Returns `[]` for empty input rather than throwing.
 */
export function extractRefs(text: string, options: ExtractRefsOptions = {}): EntityRef[] {
  const { includeRepoSlugs = false, limit = 64 } = options;
  if (!text) return [];

  const found = new Map<string, EntityRef>();

  for (const m of text.matchAll(JIRA_RE)) {
    push(found, { kind: "jira", id: m[1], label: m[1], href: `/work?ticket=${m[1]}` });
  }

  for (const m of text.matchAll(PR_URL_RE)) {
    const id = `${m[1]}/${m[2]}#${m[3]}`;
    push(found, { kind: "pr", id, label: id, href: m[0] });
  }

  for (const m of text.matchAll(PR_SHORT_RE)) {
    const id = `${m[1]}#${m[2]}`;
    push(found, {
      kind: "pr",
      id,
      label: id,
      href: `https://github.com/${m[1]}/pull/${m[2]}`,
    });
  }

  for (const m of text.matchAll(SHA_RE)) {
    push(found, { kind: "repo", id: `commit:${m[1]}`, label: m[1].slice(0, 8) });
  }

  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (target) push(found, { kind: "note", id: target, label: target, href: `/notes/${target}` });
  }

  for (const m of text.matchAll(TASK_MARKER_RE)) {
    push(found, { kind: "task", id: m[1], label: `Task ${m[1]}`, href: "/work" });
  }

  if (includeRepoSlugs) {
    for (const m of text.matchAll(REPO_SLUG_RE)) {
      const slug = m[1];
      // A path segment ending in a file extension is a file, not a repo.
      if (/\.[a-z]{1,5}$/i.test(slug)) continue;
      if (slug.split("/").length !== 2) continue;
      push(found, {
        kind: "repo",
        id: slug,
        label: slug,
        href: `https://github.com/${slug}`,
      });
    }
  }

  return [...found.values()].slice(0, limit);
}

/** `extractRefs` but returning just the stable keys, which is what chunks store. */
export function extractRefKeys(text: string, options?: ExtractRefsOptions): string[] {
  return extractRefs(text, options).map(entityKey);
}

/**
 * Merge derived refs into explicit ones, explicit winning on label/href.
 *
 * Hand-written links carry intent ("the PR that broke it") that a regex can't
 * reconstruct, so they must not be overwritten by a derived duplicate.
 */
export function mergeDerivedRefs(
  explicit: readonly EntityRef[],
  derived: readonly EntityRef[],
): EntityRef[] {
  const merged = new Map<string, EntityRef>();
  for (const ref of derived) merged.set(entityKey(ref), ref);
  for (const ref of explicit) merged.set(entityKey(ref), ref);
  return [...merged.values()];
}

/** Rebuild a display ref from a stored `kind:id` key. */
export function refFromKey(key: string): EntityRef | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const kind = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!id) return null;

  switch (kind) {
    case "jira":
      return { kind: "jira", id, label: id, href: `/work?ticket=${id}` };
    case "pr": {
      const [slug, num] = id.split("#");
      return {
        kind: "pr",
        id,
        label: id,
        href: num ? `https://github.com/${slug}/pull/${num}` : undefined,
      };
    }
    case "note":
      return { kind: "note", id, label: id, href: `/notes/${id}` };
    case "diagram": {
      const raw = id.replace(/^\/diagrams\//, "").replace(/^diagrams\//, "");
      return {
        kind: "diagram",
        id: id.startsWith("diagrams/") ? id : `diagrams/${raw}`,
        label: raw.split("/").pop() || raw || id,
        href: raw ? `/diagrams/${raw}` : "/diagrams",
      };
    }
    case "task":
      return { kind: "task", id, label: `Task ${id}`, href: "/work" };
    case "repo":
      return {
        kind: "repo",
        id,
        label: id.startsWith("commit:") ? id.slice(7, 15) : id,
        href: id.startsWith("commit:") ? undefined : `https://github.com/${id}`,
      };
    case "meeting":
    case "calendar":
      return { kind: kind === "meeting" ? "meeting" : "calendar", id, label: id };
    default:
      return null;
  }
}
