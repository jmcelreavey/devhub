/**
 * Unified catalog rows: repo catalog entries plus local-only discoveries (client-safe).
 */

import {
  canImportLocalCandidate,
  localCatalogStatusLabel,
  type LocalCatalogStatus,
  type LocalSkillImportCandidate,
} from "./local-skills-types";
import type { SkillListItem, SkillSourceFilter } from "./skills-api-types";

export interface AgentListItem {
  name: string;
  description: string | null;
  /** True for plugin-contributed agents — read-only in DevHub (edit in the plugin repo). */
  readOnly?: boolean;
}

export type CatalogListItem = SkillListItem | AgentListItem;

export interface ManagedCatalogRowBase {
  name: string;
  description: string | null;
}

export interface ManagedCatalogCatalogRow<T extends CatalogListItem = CatalogListItem>
  extends ManagedCatalogRowBase {
  kind: "catalog";
  item: T;
  /** Local copy differs from shared; user can pull into catalog. */
  localCandidate?: LocalSkillImportCandidate;
}

export interface ManagedCatalogLocalOnlyRow extends ManagedCatalogRowBase {
  kind: "local-only";
  candidate: LocalSkillImportCandidate;
}

export type ManagedCatalogRow<T extends CatalogListItem = CatalogListItem> =
  | ManagedCatalogCatalogRow<T>
  | ManagedCatalogLocalOnlyRow;

function rowNeedsMigration(row: ManagedCatalogRow): boolean {
  if (row.kind === "local-only") return canImportLocalCandidate(row.candidate);
  return !!row.localCandidate && canImportLocalCandidate(row.localCandidate);
}

export function rowDisplayName(row: ManagedCatalogRow): string {
  return row.name;
}

export function rowDescription(row: ManagedCatalogRow): string | null {
  if (row.kind === "catalog") return row.item.description;
  return null;
}

export function canAddToCatalog(row: ManagedCatalogRow): boolean {
  if (row.kind === "local-only") return canImportLocalCandidate(row.candidate);
  return !!row.localCandidate && canImportLocalCandidate(row.localCandidate);
}

export function localMigrationStatus(row: ManagedCatalogRow): LocalCatalogStatus | null {
  if (row.kind === "local-only") return row.candidate.status;
  return row.localCandidate?.status ?? null;
}

export function isCatalogReadOnly(row: ManagedCatalogRow): boolean {
  return row.kind === "catalog" && "readOnly" in row.item && !!row.item.readOnly;
}

/** Catalog devhub entries and local-only rows; never ai-tools upstream skills. */
export function canDeleteRow(row: ManagedCatalogRow): boolean {
  if (isCatalogReadOnly(row)) return false;
  if (row.kind === "local-only") return true;
  if (row.kind === "catalog" && isSkillRow(row)) return row.item.source !== "ai-tools";
  return row.kind === "catalog";
}

/** Eye toggle: catalog rows skip sync push; local-only rows skip prune (by name on disk). */
export function participatesInSync(row: ManagedCatalogRow): boolean {
  return row.kind === "catalog" || row.kind === "local-only";
}

export function isSkillRow(row: ManagedCatalogRow): row is ManagedCatalogRow<SkillListItem> {
  return row.kind === "catalog" && "source" in row.item;
}

export function skillSourceForRow(row: ManagedCatalogRow<SkillListItem>): SkillListItem["source"] | "local" {
  if (row.kind === "local-only") return "local";
  return row.item.source;
}

export function buildManagedCatalogRows<T extends CatalogListItem>(
  catalogItems: T[],
  localCandidates: LocalSkillImportCandidate[],
): ManagedCatalogRow<T>[] {
  const catalogByName = new Map(catalogItems.map((item) => [item.name, item]));
  const localByName = new Map(localCandidates.map((c) => [c.name, c]));
  const rows: ManagedCatalogRow<T>[] = [];

  const sortedCatalog = [...catalogItems].sort((a, b) => a.name.localeCompare(b.name));
  for (const item of sortedCatalog) {
    const local = localByName.get(item.name);
    const localCandidate =
      local && canImportLocalCandidate(local) ? local : undefined;
    rows.push({
      kind: "catalog",
      name: item.name,
      description: item.description,
      item,
      localCandidate,
    });
  }

  const seen = new Set(catalogByName.keys());
  const sortedLocal = [...localCandidates].sort((a, b) => a.name.localeCompare(b.name));
  for (const candidate of sortedLocal) {
    if (seen.has(candidate.name)) continue;
    if (!canImportLocalCandidate(candidate)) continue;
    rows.push({
      kind: "local-only",
      name: candidate.name,
      description: null,
      candidate,
    });
  }

  return rows.sort((a, b) => {
    const aMigrate = rowNeedsMigration(a) ? 0 : 1;
    const bMigrate = rowNeedsMigration(b) ? 0 : 1;
    if (aMigrate !== bMigrate) return aMigrate - bMigrate;
    return a.name.localeCompare(b.name);
  });
}

export function filterManagedRowsBySkillSource(
  rows: ManagedCatalogRow<SkillListItem>[],
  filter: SkillSourceFilter,
): ManagedCatalogRow<SkillListItem>[] {
  if (filter === "all") return rows;
  if (filter === "local") {
    return rows.filter((row) => row.kind === "local-only" || !!row.localCandidate);
  }
  return rows.filter((row) => row.kind === "catalog" && row.item.source === filter);
}

export function filterManagedRowsLocalOnly(rows: ManagedCatalogRow[]): ManagedCatalogRow[] {
  return rows.filter((row) => row.kind === "local-only" || !!row.localCandidate);
}

export function countManagedRowsBySkillSource(
  rows: ManagedCatalogRow<SkillListItem>[],
): Record<SkillSourceFilter, number> {
  const devhub = rows.filter((r) => r.kind === "catalog" && r.item.source === "devhub").length;
  const aiTools = rows.filter((r) => r.kind === "catalog" && r.item.source === "ai-tools").length;
  const local = rows.filter((r) => r.kind === "local-only" || !!r.localCandidate).length;
  return { all: rows.length, devhub, "ai-tools": aiTools, local };
}

export function countImportableRows(rows: ManagedCatalogRow[]): number {
  return rows.filter(canAddToCatalog).length;
}

export function countAgentManagedRows(
  rows: ManagedCatalogRow[],
): { all: number; local: number } {
  const local = rows.filter((r) => r.kind === "local-only" || !!r.localCandidate).length;
  return { all: rows.length, local };
}

export { localCatalogStatusLabel };
