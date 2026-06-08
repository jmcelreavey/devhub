import {
  catalogApiBase,
  localContentApiPath,
  localCandidatesApiPath,
  type ManagedKind,
} from "./managed-catalog-kind";
import type { ManagedCatalogRow } from "./managed-catalog-rows";
import {
  buildManagedCatalogRows,
  filterManagedRowsBySkillSource,
  filterManagedRowsLocalOnly,
} from "./managed-catalog-rows";
import type { LocalSkillImportCandidate } from "./local-skills-types";
import type { SkillListItem, SkillSourceFilter } from "./skills-api-types";
import type { AgentListItem } from "./managed-catalog-rows";
import type { AgentSourceFilter } from "./managed-catalog-kind";

export async function fetchLocalCandidates(
  kind: ManagedKind,
): Promise<LocalSkillImportCandidate[]> {
  const r = await fetch(localCandidatesApiPath(kind));
  const data = (await r.json()) as { candidates?: LocalSkillImportCandidate[] };
  return Array.isArray(data.candidates) ? data.candidates : [];
}

export async function fetchAllLocalCandidates(): Promise<{
  skills: LocalSkillImportCandidate[];
  agents: LocalSkillImportCandidate[];
}> {
  const [skills, agents] = await Promise.all([
    fetchLocalCandidates("skill"),
    fetchLocalCandidates("agent"),
  ]);
  return { skills, agents };
}

export async function fetchManagedRowContent(kind: ManagedKind, row: ManagedCatalogRow): Promise<string> {
  const url =
    row.kind === "local-only"
      ? localContentApiPath(kind, row.name)
      : `${catalogApiBase(kind)}/${encodeURIComponent(row.name)}`;
  const r = await fetch(url);
  const data = (await r.json()) as { content?: string; error?: string };
  if (!r.ok) throw new Error(data.error ?? "Failed to load content");
  return data.content ?? "";
}

export interface FilterManagedRowsOptions {
  query?: string;
  highlightNames?: string[];
  skillSourceFilter?: SkillSourceFilter;
  agentSourceFilter?: AgentSourceFilter;
}

export function filterManagedRows(
  rows: ManagedCatalogRow[],
  kind: ManagedKind,
  opts: FilterManagedRowsOptions,
): ManagedCatalogRow[] {
  let filtered = rows;
  if (kind === "skill" && opts.skillSourceFilter) {
    filtered = filterManagedRowsBySkillSource(
      filtered as ManagedCatalogRow<SkillListItem>[],
      opts.skillSourceFilter,
    );
  } else if (kind === "agent" && opts.agentSourceFilter === "local") {
    filtered = filterManagedRowsLocalOnly(filtered);
  }

  if (opts.highlightNames && opts.highlightNames.length > 0) {
    const highlight = new Set(opts.highlightNames);
    return filtered.filter((r) => highlight.has(r.name));
  }

  if (opts.query?.trim()) {
    const q = opts.query.trim().toLowerCase();
    return filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }

  return filtered;
}

export function managedRowsForKind(
  kind: ManagedKind,
  skills: SkillListItem[],
  agents: AgentListItem[],
  localSkillCandidates: LocalSkillImportCandidate[],
  localAgentCandidates: LocalSkillImportCandidate[],
): ManagedCatalogRow[] {
  return kind === "skill"
    ? buildManagedCatalogRows(skills, localSkillCandidates)
    : buildManagedCatalogRows(agents, localAgentCandidates);
}
