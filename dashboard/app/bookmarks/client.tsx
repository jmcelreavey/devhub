"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { BlockNoteEditor } from "@/components/BlockNoteEditor";
import { Bookmark, Save, Check } from "lucide-react";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";
import { FetchError, EmptyState } from "@/components";

export default function BookmarksPage() {
  const [blocks, setBlocks] = useState<DevHubPartialBlock[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/notes/bookmarks")
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data) setBlocks(data.content);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const handleChange = useCallback((newBlocks: DevHubPartialBlock[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/notes/bookmarks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newBlocks }),
        });
        if (!r.ok) throw new Error(await r.text());
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } catch {
        setStatus("error");
      }
    }, 1500);
  }, []);

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="page-title">Bookmarks</div>
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: "var(--text-subtle)" }}
        >
          {status === "saving" && (
            <>
              <Save size={12} className="animate-pulse" /> Saving…
            </>
          )}
          {status === "saved" && (
            <>
              <Check size={12} style={{ color: "var(--success)" }} />
              <span style={{ color: "var(--success)" }}>Saved</span>
            </>
          )}
        </div>
      </div>

      {error && <FetchError message={error} />}

      {notFound && (
        <EmptyState
          icon={<Bookmark size={28} />}
          title="No bookmarks yet."
          subtitle={
            <>
              Create a note at <code>notes/bookmarks.json</code> to get started.
            </>
          }
        />
      )}

      {blocks && (
        <BlockNoteEditor initialContent={blocks} onChange={handleChange} vaultId="notes" />
      )}
    </div>
  );
}
