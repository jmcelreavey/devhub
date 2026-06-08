import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCollectionsDir, getRepoRoot } from "../notes-dir";
import { safeReadJSON, withMutex, writeAtomic } from "../atomic-write";
import { masterScopeConflictLabel, normalizeScopePath } from "./paths";
import { MASTER_LIST_SCHEMA_VERSION, type MasterList, type MasterListItem } from "./types";

export type { MasterList, MasterListItem, SharedChecklistEntry } from "./types";
export { normalizeItemName } from "./types";
export { normalizeScopePath, getMasterForNotePath, parentScopePath } from "./paths";

export interface MasterListItemInput {
  name: string;
  checked?: boolean;
  notes?: string;
}

export interface MasterListPatch {
  name?: string;
  scopePath?: string;
  icon?: string | null;
}

export interface MasterListItemPatch {
  name?: string;
  checked?: boolean;
  notes?: string | null;
}

function mutexKey(): string {
  return `collections:${getRepoRoot()}`;
}

function collectionsDir(): string {
  return getCollectionsDir();
}

function masterFile(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid master list id");
  return path.join(collectionsDir(), `${id}.json`);
}

function nowISO(): string {
  return new Date().toISOString();
}

function compactString(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeItem(raw: Partial<MasterListItem>): MasterListItem | null {
  if (!raw || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const now = nowISO();
  return {
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    name: raw.name.trim(),
    checked: Boolean(raw.checked),
    notes: compactString(raw.notes),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
}

interface LegacyCollection {
  id?: string;
  name?: string;
  kind?: string;
  notePath?: string;
  sourceCollectionId?: string;
  schemaVersion?: number;
  scopePath?: string;
  icon?: string;
  items?: Array<{
    id?: string;
    name?: string;
    owned?: boolean;
    checked?: boolean;
    notes?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

function migrateLegacy(raw: unknown): MasterList | null {
  const c = raw as LegacyCollection;
  if (!c || typeof c.id !== "string" || typeof c.name !== "string") return null;

  if (c.schemaVersion === MASTER_LIST_SCHEMA_VERSION && typeof c.scopePath === "string") {
    const items = Array.isArray(c.items) ? c.items : [];
    const now = nowISO();
    return {
      schemaVersion: MASTER_LIST_SCHEMA_VERSION,
      id: c.id,
      name: c.name.trim(),
      scopePath: normalizeScopePath(c.scopePath),
      icon: compactString(c.icon),
      items: items
        .map((item) =>
          normalizeItem({
            id: item.id,
            name: item.name,
            checked: item.checked ?? item.owned ?? false,
            notes: item.notes,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }),
        )
        .filter((item): item is MasterListItem => item !== null),
      createdAt: c.createdAt ?? now,
      updatedAt: c.updatedAt ?? now,
    };
  }

  if (c.kind === "requirements" || (c.sourceCollectionId && (!c.items || c.items.length === 0))) {
    return null;
  }

  const scopePath = normalizeScopePath(c.notePath ?? c.scopePath ?? "");
  const items = Array.isArray(c.items) ? c.items : [];
  const now = nowISO();
  const defaultChecked = c.kind === "inventory";

  return {
    schemaVersion: MASTER_LIST_SCHEMA_VERSION,
    id: c.id,
    name: c.name.trim(),
    scopePath,
    icon: compactString(c.icon),
    items: items
      .map((item) =>
        normalizeItem({
          id: item.id,
          name: item.name,
          checked: item.checked ?? item.owned ?? defaultChecked,
          notes: item.notes,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }),
      )
      .filter((item): item is MasterListItem => item !== null),
    createdAt: c.createdAt ?? now,
    updatedAt: c.updatedAt ?? now,
  };
}

function readMaster(id: string): MasterList | null {
  const raw = safeReadJSON<unknown>(masterFile(id), null);
  if (!raw) return null;
  return migrateLegacy(raw);
}

async function saveMaster(master: MasterList): Promise<void> {
  await writeAtomic(masterFile(master.id), JSON.stringify(master, null, 2) + "\n");
}

function deleteMasterFile(id: string): void {
  const file = masterFile(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function listMasterLists(): MasterList[] {
  const dir = collectionsDir();
  if (!fs.existsSync(dir)) return [];

  const validId = /^[a-zA-Z0-9_-]+$/;
  const masters: MasterList[] = [];
  const toDelete: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue;
    const id = entry.name.replace(/\.json$/, "");
    if (!validId.test(id)) continue;

    const raw = safeReadJSON<unknown>(masterFile(id), null);
    const master = migrateLegacy(raw);
    if (!master) {
      toDelete.push(id);
      continue;
    }

    const legacy = raw as LegacyCollection;
    const needsWrite =
      !raw ||
      legacy.schemaVersion !== MASTER_LIST_SCHEMA_VERSION ||
      legacy.scopePath !== master.scopePath ||
      legacy.notePath !== undefined;

    if (needsWrite) {
      fs.writeFileSync(masterFile(id), JSON.stringify(master, null, 2) + "\n");
    }
    masters.push(master);
  }

  for (const id of toDelete) {
    deleteMasterFile(id);
  }

  return masters.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMasterList(id: string): MasterList | null {
  return readMaster(id);
}

export function getMasterByScopePath(scopePath: string): MasterList | undefined {
  const normalized = normalizeScopePath(scopePath);
  return listMasterLists().find((m) => m.scopePath === normalized);
}

export async function createMasterList(input: {
  name: string;
  scopePath: string;
  icon?: string;
}): Promise<MasterList> {
  const scopePath = normalizeScopePath(input.scopePath);
  const existing = listMasterLists().find((m) => m.scopePath === scopePath);
  if (existing) {
    return Promise.reject(
      new Error(`A master list already exists for ${masterScopeConflictLabel(scopePath)}`),
    );
  }
  return withMutex(mutexKey(), async () => {
    const conflict = listMasterLists().find((m) => m.scopePath === scopePath);
    if (conflict) {
      throw new Error(`A master list already exists for ${masterScopeConflictLabel(scopePath)}`);
    }
    const now = nowISO();
    const master: MasterList = {
      schemaVersion: MASTER_LIST_SCHEMA_VERSION,
      id: randomUUID(),
      name: input.name.trim(),
      scopePath,
      icon: compactString(input.icon),
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveMaster(master);
    return master;
  });
}

export async function updateMasterList(id: string, patch: MasterListPatch): Promise<MasterList | null> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(id);
    if (!master) return null;
    if (patch.name !== undefined) master.name = patch.name.trim();
    if (patch.scopePath !== undefined) {
      const scopePath = normalizeScopePath(patch.scopePath);
      const conflict = listMasterLists().find((m) => m.id !== id && m.scopePath === scopePath);
      if (conflict) {
        throw new Error(`A master list already exists for ${masterScopeConflictLabel(scopePath)}`);
      }
      master.scopePath = scopePath;
    }
    if (patch.icon !== undefined) master.icon = compactString(patch.icon);
    master.updatedAt = nowISO();
    await saveMaster(master);
    return master;
  });
}

export async function deleteMasterList(id: string): Promise<boolean> {
  return withMutex(mutexKey(), async () => {
    const file = masterFile(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  });
}

export async function addMasterItem(id: string, input: MasterListItemInput): Promise<MasterListItem | null> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(id);
    if (!master) return null;
    return addMasterItemUnlocked(master, input);
  });
}

export async function updateMasterItem(
  id: string,
  itemId: string,
  patch: MasterListItemPatch,
): Promise<MasterListItem | null> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(id);
    if (!master) return null;
    const item = master.items.find((candidate) => candidate.id === itemId);
    if (!item) return null;
    if (patch.name !== undefined) item.name = patch.name.trim();
    if (patch.checked !== undefined) item.checked = patch.checked;
    if (patch.notes !== undefined) item.notes = compactString(patch.notes);
    item.updatedAt = nowISO();
    master.updatedAt = item.updatedAt;
    await saveMaster(master);
    return item;
  });
}

export async function deleteMasterItem(id: string, itemId: string): Promise<boolean> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(id);
    if (!master) return false;
    const next = master.items.filter((item) => item.id !== itemId);
    if (next.length === master.items.length) return false;
    master.items = next;
    master.updatedAt = nowISO();
    await saveMaster(master);
    return true;
  });
}

export async function reorderMasterItems(id: string, itemIds: string[]): Promise<MasterList | null> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(id);
    if (!master) return null;
    const byId = new Map(master.items.map((item) => [item.id, item]));
    const ordered = itemIds.map((itemId) => byId.get(itemId)).filter((item): item is MasterListItem => !!item);
    const idSet = new Set(itemIds);
    const remaining = master.items.filter((item) => !idSet.has(item.id));
    master.items = [...ordered, ...remaining];
    master.updatedAt = nowISO();
    await saveMaster(master);
    return master;
  });
}

export async function promoteItemToMaster(
  masterId: string,
  input: { name: string; checked?: boolean },
): Promise<MasterListItem | null> {
  return withMutex(mutexKey(), async () => {
    const master = readMaster(masterId);
    if (!master) return null;
    const key = input.name.trim().toLowerCase();
    const existing = master.items.find((item) => item.name.trim().toLowerCase() === key);
    if (existing) {
      if (input.checked !== undefined) existing.checked = input.checked;
      existing.updatedAt = nowISO();
      master.updatedAt = existing.updatedAt;
      await saveMaster(master);
      return existing;
    }
    return addMasterItemUnlocked(master, input);
  });
}

async function addMasterItemUnlocked(master: MasterList, input: MasterListItemInput): Promise<MasterListItem | null> {
  const item = normalizeItem({
    name: input.name,
    checked: input.checked ?? false,
    notes: input.notes,
  });
  if (!item) return null;
  master.items.push(item);
  master.updatedAt = nowISO();
  await saveMaster(master);
  return item;
}
