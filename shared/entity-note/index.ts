/**
 * Cross-entity link contract — one shape for core UI, DevHub MCP, and plugins.
 *
 * Durable edges live in:
 *   1. Note bodies — `## Links` section (EntityRef lines / ::task-ref markers)
 *   2. Task.links — hop-around edges that don't require a note (task↔PR, task↔calendar)
 *
 * Stable note paths (`task-notes/…`, `meetings/…`, `pr-reviews/…`) are the
 * entity→note edge. Reverse lookups come from scanning those notes + task.links.
 *
 * Plugins: import via `@/lib/entity-note` after materialize, or from
 * `shared/entity-note` in MCP/sibling packages. Do not invent per-plugin formats.
 */

export type EntityKind = "task" | "meeting" | "pr" | "note" | "calendar" | "jira";

export interface EntityRef {
  kind: EntityKind;
  /** Stable id within the kind (task id, `owner/repo#n`, calendar event id, note path, …). */
  id: string;
  label: string;
  /** In-app or external href for hop-around. */
  href?: string;
  /**
   * Opaque vault marker (e.g. `::task-ref id date label`).
   * When set, wins over the markdown link formatting in ## Links.
   */
  marker?: string;
}

export interface SlugifyOptions {
  maxLen?: number;
  fallback?: string;
}

export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { maxLen = 48, fallback = "untitled" } = options;
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLen) || fallback;
}

export function entityKey(ref: Pick<EntityRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

export function joinMarkdownLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => line != null).join("\n");
}

const KIND_LABEL: Record<EntityKind, string> = {
  task: "Task",
  meeting: "Meeting",
  calendar: "Event",
  pr: "PR",
  note: "Note",
  jira: "Jira",
};

/** One markdown line for an EntityRef (marker, or labelled link / plain text). */
export function formatEntityRefLine(ref: EntityRef): string {
  if (ref.marker) return ref.marker;
  const kind = KIND_LABEL[ref.kind] ?? ref.kind;
  if (ref.href) return `**${kind}:** [${ref.label}](${ref.href})`;
  return `**${kind}:** ${ref.label}`;
}

/**
 * A short "## Links" block pointing at related entities.
 * Accepts EntityRef objects and/or raw markdown lines.
 */
export function buildEntityLinksSection(
  refs: Array<EntityRef | string | null | undefined>,
): string {
  const body = refs
    .map((ref) => {
      if (ref == null || ref === "") return null;
      if (typeof ref === "string") return ref;
      return formatEntityRefLine(ref);
    })
    .filter((line): line is string => line != null && line !== "");
  if (body.length === 0) return "";
  return ["## Links", "", ...body, ""].join("\n");
}

const TASK_REF_RE = /^::task-ref\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;
const LINK_LINE_RE = /^\*\*([^*]+):\*\*\s+(?:\[([^\]]+)\]\(([^)]+)\)|(.+))\s*$/;

/** Parse a note body's ## Links section (and loose ::task-ref lines) into EntityRefs. */
export function parseEntityLinksFromMarkdown(markdown: string): EntityRef[] {
  const refs: EntityRef[] = [];
  const seen = new Set<string>();
  const push = (ref: EntityRef) => {
    const key = entityKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  const lines = markdown.split("\n");
  let inLinks = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+Links\s*$/i.test(line)) {
      inLinks = true;
      continue;
    }
    if (inLinks && /^##\s+/.test(line)) {
      inLinks = false;
    }

    const taskMatch = line.match(TASK_REF_RE);
    if (taskMatch) {
      push({
        kind: "task",
        id: taskMatch[1],
        label: taskMatch[3]?.trim() || taskMatch[1],
        href: "/work?tab=tasks",
        marker: line,
      });
      continue;
    }

    if (!inLinks) continue;
    if (!line || line.startsWith("#")) continue;

    const linkMatch = line.match(LINK_LINE_RE);
    if (!linkMatch) continue;
    const kindRaw = linkMatch[1].trim().toLowerCase();
    const label = (linkMatch[2] || linkMatch[4] || "").trim();
    const href = linkMatch[3]?.trim();
    const kind = kindFromLabel(kindRaw);
    if (!kind || !label) continue;
    push({
      kind,
      id: href || label,
      label,
      href: href || undefined,
    });
  }
  return refs;
}

function kindFromLabel(raw: string): EntityKind | null {
  switch (raw) {
    case "task":
    case "work":
      return "task";
    case "event":
    case "calendar":
      return "calendar";
    case "meeting":
    case "join":
      return "meeting";
    case "pr":
    case "pull request":
      return "pr";
    case "note":
      return "note";
    case "jira":
      return "jira";
    default:
      return null;
  }
}

/** Best-effort in-app href for a ref (cards / relations panel). */
export function defaultHrefForRef(ref: EntityRef): string | undefined {
  if (ref.href) return ref.href;
  switch (ref.kind) {
    case "task":
      return "/work?tab=tasks";
    case "note":
      return `/notes/${ref.id.split("/").map(encodeURIComponent).join("/")}`;
    case "pr": {
      // id form: owner/repo#123
      const m = ref.id.match(/^([^/#]+\/[^/#]+)#(\d+)$/);
      if (m) return `https://github.com/${m[1]}/pull/${m[2]}`;
      return undefined;
    }
    case "calendar":
      return "/calendar";
    default:
      return undefined;
  }
}

export function mergeEntityRefs(...groups: Array<EntityRef[] | undefined>): EntityRef[] {
  const out: EntityRef[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    for (const ref of group) {
      const key = entityKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Replace or append the note's `## Links` section with the given refs.
 * Preserves body content above/below the section. Empty refs removes the section.
 */
export function upsertEntityLinksInMarkdown(markdown: string, refs: EntityRef[]): string {
  const section = buildEntityLinksSection(refs);
  const lines = markdown.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^##\s+Links\s*$/i.test(trimmed)) {
      start = i;
      continue;
    }
    if (start >= 0 && /^##\s+/.test(trimmed)) {
      end = i;
      break;
    }
  }

  if (start < 0) {
    const base = markdown.replace(/\s*$/, "");
    if (!section) return base;
    return base ? `${base}\n\n${section}` : section;
  }

  if (end < 0) end = lines.length;
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  if (!section) {
    return [...before, ...after].join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, (m) =>
      m.length > 1 ? "\n" : m,
    );
  }

  const sectionLines = section.replace(/\n$/, "").split("\n");
  const needsGap = after.length > 0 && after[0] !== "";
  return [...before, ...sectionLines, ...(needsGap ? [""] : []), ...after].join("\n");
}
