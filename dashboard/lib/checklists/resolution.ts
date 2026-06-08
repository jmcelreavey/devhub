import type { MasterList, MasterListItem, SharedChecklistEntry } from "./types";
import { normalizeItemName } from "./types";

export function masterItemById(master: MasterList | undefined, itemId: string): MasterListItem | undefined {
  return master?.items.find((item) => item.id === itemId);
}

export function findMasterItemByName(master: MasterList, name: string): MasterListItem | undefined {
  const key = normalizeItemName(name);
  return master.items.find((item) => normalizeItemName(item.name) === key);
}

export function entryDisplayChecked(entry: SharedChecklistEntry, master?: MasterList): boolean {
  if (entry.masterItemId) {
    const item = masterItemById(master, entry.masterItemId);
    return item?.checked ?? false;
  }
  return entry.standaloneChecked ?? false;
}

export function entryIsBrokenLink(entry: SharedChecklistEntry, master?: MasterList): boolean {
  return Boolean(entry.masterItemId && !masterItemById(master, entry.masterItemId));
}

export function entryLabelDrift(entry: SharedChecklistEntry, master?: MasterList): boolean {
  if (!entry.masterItemId) return false;
  const item = masterItemById(master, entry.masterItemId);
  if (!item) return false;
  return normalizeItemName(entry.label) !== normalizeItemName(item.name);
}

export function masterSummary(master: MasterList): string {
  const total = master.items.length;
  const checked = master.items.filter((i) => i.checked).length;
  if (total === 0) return "No items yet";
  return `${checked} of ${total} checked`;
}
