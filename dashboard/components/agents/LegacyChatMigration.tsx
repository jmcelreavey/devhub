"use client";

import { useEffect } from "react";
import { useToast } from "@/lib/hooks/use-toast";

const keys = ["devhub:agent-chat.v1", "devhub:agent-chat-popout", "devhub:terminal-dock.v1"];
const marker = "devhub:agent-chat-archive.v1";

/** Both stores existed across releases. Keep the originals even after verification. */
export function legacyChatExport(session: Storage, local: Storage): string | null {
  const read = (storage: Storage) => Object.fromEntries(keys.flatMap((key) => {
    const value = storage.getItem(key);
    return value === null ? [] : [[key, value]];
  }));
  const snapshot = { version: 1, session: read(session), local: read(local) };
  if (!("devhub:agent-chat.v1" in snapshot.session) && !("devhub:agent-chat.v1" in snapshot.local)) return null;
  return JSON.stringify(snapshot);
}

export function LegacyChatMigration() {
  const toast = useToast();
  useEffect(() => {
    let disposed = false;
    async function archive() {
      const raw = legacyChatExport(sessionStorage, localStorage);
      if (!raw) return;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      const id = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/aionui/legacy-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
      if (!response.ok) throw new Error("Your old agent chats are still in this browser. Their archive could not be saved; reload to retry.");
      const saved = await response.json();
      if (saved.id !== id) throw new Error("The chat archive did not match the browser copy.");
      const check = await fetch(`/api/aionui/legacy-archive?id=${id}`);
      if (!check.ok || (await check.json()).raw !== raw) throw new Error("The chat archive could not be verified. Your browser copy is unchanged.");
      sessionStorage.setItem(marker, id);
    }
    void archive().catch((error: unknown) => { if (!disposed) toast.error(error instanceof Error ? error.message : "Could not archive old chats. Your browser copy is unchanged."); });
    return () => { disposed = true; };
  }, [toast]);
  return null;
}
