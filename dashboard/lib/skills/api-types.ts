/** API shapes for the Skills page and routes (shared client + server). */

export type SkillOrigin = "devhub" | "vendor" | "ai-tools" | `plugin:${string}`;

/** Concrete filter buttons in the Skills UI. Plugin skills show under "all". */
export type SkillSourceFilter = "all" | "devhub" | "vendor" | "ai-tools" | "local";

/**
 * True for read-only sources (vendored third-party, upstream ai-tools, any plugin).
 *
 * Vendored skills are read-only for the same reason plugin skills are: DevHub is
 * not their source of truth. Editing one here means the next re-vendor silently
 * discards the change, and the provenance recorded in skills/vendor/NOTICE.md
 * stops describing the code that actually ships.
 */
export function isReadOnlySkillOrigin(origin: SkillOrigin): boolean {
  return origin === "vendor" || origin === "ai-tools" || origin.startsWith("plugin:");
}

export interface SkillListItem {
  name: string;
  description: string | null;
  source: SkillOrigin;
  readOnly: boolean;
  overridesUpstream?: boolean;
  /** SPDX-ish licence id from frontmatter. Non-null for vendored skills. */
  license?: string | null;
  /** Upstream project URL from `metadata.source`, when declared. */
  sourceUrl?: string | null;
}

export interface AiToolsMeta {
  available: boolean;
  path: string | null;
  root: string;
  syncEnabled: boolean;
}

export interface SkillsListResponse {
  skills: SkillListItem[];
  aiTools: AiToolsMeta;
}

export interface RefreshAiToolsResponse {
  ok: boolean;
  disabled?: boolean;
  message?: string;
  commit?: string;
  pulled?: boolean;
  warning?: string;
  lines?: string[];
}

export const SKILL_SOURCE_FILTER_OPTIONS: ReadonlyArray<{ id: SkillSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "devhub", label: "DevHub" },
  { id: "vendor", label: "Vendored" },
  { id: "ai-tools", label: "ai-tools" },
  { id: "local", label: "Local" },
];

export function countSkillsBySource(skills: SkillListItem[]): Record<"all" | SkillOrigin, number> {
  const devhub = skills.filter((s) => s.source === "devhub").length;
  const vendor = skills.filter((s) => s.source === "vendor").length;
  const aiTools = skills.filter((s) => s.source === "ai-tools").length;
  return { all: skills.length, devhub, vendor, "ai-tools": aiTools };
}

export function filterSkillsBySource(skills: SkillListItem[], filter: SkillSourceFilter): SkillListItem[] {
  if (filter === "all") return skills;
  return skills.filter((s) => s.source === filter);
}
