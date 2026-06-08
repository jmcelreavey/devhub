"use client";

import { useCallback, useEffect } from "react";
import { mutate } from "swr";
import type { MasterList, MasterListItem } from "./types";
import { applyOptimisticMasterPatch, mergeMasterPatchResponse } from "./mutate-cache";

export const COLLECTIONS_LIST_KEY = "/api/collections";

const CHANNEL = "devhub-checklists";

let suppressBroadcastRevalidate = false;

export function broadcastChecklistMutate(skipSelfRevalidate = false): void {
  if (typeof window === "undefined") return;
  if (skipSelfRevalidate) suppressBroadcastRevalidate = true;
  try {
    new BroadcastChannel(CHANNEL).postMessage("mutate");
  } catch {
    /* ignore */
  }
}

function revalidateCollectionCaches(): void {
  void mutate(COLLECTIONS_LIST_KEY, undefined, { revalidate: true });
}

export function useChecklistSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => {
        if (suppressBroadcastRevalidate) {
          suppressBroadcastRevalidate = false;
          return;
        }
        revalidateCollectionCaches();
      };
    } catch {
      /* ignore */
    }
    return () => channel?.close();
  }, []);

  const patchMasterCache = useCallback(
    async (
      masterId: string,
      body: Record<string, unknown>,
      request: () => Promise<Response>,
    ) => {
      await mutate(
        COLLECTIONS_LIST_KEY,
        (current: MasterList[] | undefined) => applyOptimisticMasterPatch(current, masterId, body),
        { revalidate: false },
      );
      const res = await request();
      if (!res.ok) {
        const message = await res.text().catch(() => res.statusText);
        await revalidateCollectionCaches();
        throw new Error(message);
      }
      const data = await res.json().catch(() => null);
      await mutate(
        COLLECTIONS_LIST_KEY,
        (current: MasterList[] | undefined) => mergeMasterPatchResponse(current, masterId, body, data),
        { revalidate: false },
      );
      broadcastChecklistMutate(true);
      return data;
    },
    [],
  );

  const toggleMasterItem = useCallback(
    async (masterId: string, itemId: string, checked: boolean) => {
      if (itemId.startsWith("optimistic-")) {
        throw new Error("Item is still saving — try again in a moment.");
      }
      return patchMasterCache(
        masterId,
        {
          action: "updateItem",
          itemId,
          item: { checked },
        },
        () =>
          fetch(`/api/collections/${masterId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "updateItem",
              itemId,
              item: { checked },
            }),
          }),
      ) as Promise<MasterListItem>;
    },
    [patchMasterCache],
  );

  const promoteToMaster = useCallback(
    async (masterId: string, name: string, checked?: boolean) => {
      return patchMasterCache(
        masterId,
        { action: "promoteItem", name, checked },
        () =>
          fetch(`/api/collections/${masterId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "promoteItem",
              name,
              checked,
            }),
          }),
      ) as Promise<MasterListItem>;
    },
    [patchMasterCache],
  );

  return { toggleMasterItem, promoteToMaster, patchMasterCache };
}
