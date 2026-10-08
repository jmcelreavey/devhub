import type { EntityRef } from "../entity-note/index.ts";
import type { Task } from "./types.ts";

export const TASK_KEYS = [
  "id",
  "text",
  "done",
  "startDate",
  "endDate",
  "endReason",
  "rank",
  "legacyThrough",
  "legacyDigest",
  "legacyRowDigests",
  "jiraKey",
  "due",
  "createdAt",
  "completedAt",
  "abandonedAt",
  "abandonReason",
  "timeSpentMs",
  "notePath",
  "links",
  "stage",
  "legacyIds",
] as const;

const OMIT = new Set<string>(["timerStartedAt", "movedAt", "movedToDate", "rolledFromId", "rolledFromDate"]);

function stableLink(link: EntityRef): Record<string, unknown> {
  const source = link as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { kind: link.kind, id: link.id, label: link.label };
  if (typeof source.href === "string" && source.href) out.href = source.href;
  if (typeof source.marker === "string" && source.marker) out.marker = source.marker;
  for (const key of Object.keys(source).sort()) {
    if (key === "kind" || key === "id" || key === "label" || key === "href" || key === "marker") continue;
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Keep link order. Unknown link props are kept, sorted after the known ones. */
export function stableLinks(links: readonly EntityRef[] | undefined): Record<string, unknown>[] | undefined {
  if (!links || links.length === 0) return undefined;
  return links.map(stableLink);
}

/** Stable key order, 2-space indent, trailing newline. Unknown keys follow, sorted. */
export function serializeTask(task: Task): string {
  const source = task as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TASK_KEYS) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "links") {
      const links = stableLinks(value as EntityRef[]);
      if (links) out.links = links;
      continue;
    }
    if (key === "legacyIds" && Array.isArray(value)) {
      const ids = [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
      if (ids.length > 0) out.legacyIds = ids;
      continue;
    }
    if (key === "done") {
      out.done = value === true;
      continue;
    }
    out[key] = value;
  }
  for (const key of Object.keys(source).sort()) {
    if ((TASK_KEYS as readonly string[]).includes(key) || OMIT.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
