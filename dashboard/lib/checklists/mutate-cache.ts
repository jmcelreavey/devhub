import type { MasterList, MasterListItem } from "./types";

export function upsertMasterList(
  lists: MasterList[] | undefined,
  master: MasterList,
): MasterList[] {
  return (lists ?? []).map((m) => (m.id === master.id ? master : m));
}

export function updateMasterListById(
  lists: MasterList[] | undefined,
  masterId: string,
  updater: (master: MasterList) => MasterList,
): MasterList[] {
  return (lists ?? []).map((m) => (m.id === masterId ? updater(m) : m));
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Optimistic SWR cache update before PATCH returns. */
export function applyOptimisticMasterPatch(
  lists: MasterList[] | undefined,
  masterId: string,
  body: Record<string, unknown>,
): MasterList[] {
  const action = body.action;
  if (action === "updateCollection" && body.collection && typeof body.collection === "object") {
    const patch = body.collection as Partial<MasterList>;
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      ...patch,
      updatedAt: nowISO(),
    }));
  }
  if (action === "addItem" && body.item && typeof body.item === "object") {
    const input = body.item as { name: string; checked?: boolean };
    const item: MasterListItem = {
      id: `optimistic-${Date.now()}`,
      name: input.name.trim(),
      checked: input.checked ?? false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      items: [...m.items, item],
      updatedAt: nowISO(),
    }));
  }
  if (action === "deleteItem" && typeof body.itemId === "string") {
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      items: m.items.filter((row) => row.id !== body.itemId),
      updatedAt: nowISO(),
    }));
  }
  if (action === "updateItem" && typeof body.itemId === "string" && body.item) {
    const patch = body.item as Partial<MasterListItem>;
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      items: m.items.map((row) =>
        row.id === body.itemId ? { ...row, ...patch, updatedAt: nowISO() } : row,
      ),
      updatedAt: nowISO(),
    }));
  }
  return lists ?? [];
}

/** Merge PATCH JSON into the list cache without refetching. */
export function mergeMasterPatchResponse(
  lists: MasterList[] | undefined,
  masterId: string,
  body: Record<string, unknown>,
  data: unknown,
): MasterList[] {
  const action = body.action;
  if (action === "updateCollection" && data && typeof data === "object" && "id" in data) {
    return upsertMasterList(lists, data as MasterList);
  }
  if (action === "reorderItems" && data && typeof data === "object" && "id" in data) {
    return upsertMasterList(lists, data as MasterList);
  }
  if (action === "addItem" && data && typeof data === "object" && "id" in data) {
    const item = data as MasterListItem;
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      items: [...m.items.filter((row) => !row.id.startsWith("optimistic-")), item],
      updatedAt: item.updatedAt,
    }));
  }
  if (action === "updateItem" && data && typeof data === "object" && "id" in data) {
    const item = data as MasterListItem;
    return updateMasterListById(lists, masterId, (m) => ({
      ...m,
      items: m.items.map((row) => (row.id === item.id ? item : row)),
      updatedAt: item.updatedAt,
    }));
  }
  if (action === "deleteItem") {
    return lists ?? [];
  }
  if (action === "promoteItem" && data && typeof data === "object" && "id" in data) {
    const item = data as MasterListItem;
    return updateMasterListById(lists, masterId, (m) => {
      const exists = m.items.some((row) => row.id === item.id);
      return {
        ...m,
        items: exists ? m.items.map((row) => (row.id === item.id ? item : row)) : [...m.items, item],
        updatedAt: item.updatedAt,
      };
    });
  }
  return lists ?? [];
}
