export const MASTER_LIST_SCHEMA_VERSION = 2;

export interface MasterListItem {
  id: string;
  name: string;
  checked: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MasterList {
  schemaVersion: typeof MASTER_LIST_SCHEMA_VERSION;
  id: string;
  name: string;
  scopePath: string;
  /** Optional icon name from CHECKLIST_ICON_NAMES (see lib/checklists/icons.tsx). */
  icon?: string;
  items: MasterListItem[];
  createdAt: string;
  updatedAt: string;
}

/** Row stored in a note's sharedChecklist block props (JSON). */
export interface SharedChecklistEntry {
  id: string;
  label: string;
  masterItemId?: string;
  standaloneChecked?: boolean;
}

export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
