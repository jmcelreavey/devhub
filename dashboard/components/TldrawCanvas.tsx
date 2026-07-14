"use client";

import { useCallback, useEffect, useRef } from "react";
import { Tldraw, type Editor, type TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import type { TldrawDiagramData } from "@/lib/diagram-utils";
import { useTheme } from "@/components/ThemeToggle";
import {
  isCurrentNoteSaveGeneration,
  nextNoteSaveGeneration,
} from "@/lib/note-save-generation";
import { useNoteAutosaveInvalidationListener } from "@/lib/note-autosave-invalidation";

interface TldrawCanvasProps {
  initialData?: unknown;
  onChange?: (data: unknown) => void;
  /** Receive the mounted tldraw editor (e.g. for image export). */
  onEditorReady?: (editor: Editor) => void;
  /** When set, debounced saves are cancelled on rename/move/delete (same as notes). */
  contentSlug?: string;
}

const SAVE_DEBOUNCE_MS = 500;

export function TldrawCanvas({ initialData, onChange, onEditorReady, contentSlug }: TldrawCanvasProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped on navigation/delete/rename so debounced saves cannot write a prior diagram. */
  const saveGenerationRef = useRef(0);
  const { mode } = useTheme();

  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const invalidatePendingSave = useCallback(() => {
    saveGenerationRef.current = nextNoteSaveGeneration(saveGenerationRef.current);
    cancelPendingSave();
  }, [cancelPendingSave]);

  useNoteAutosaveInvalidationListener(contentSlug, invalidatePendingSave);

  useEffect(() => {
    invalidatePendingSave();
    return cancelPendingSave;
  }, [contentSlug, invalidatePendingSave, cancelPendingSave]);

  // tldraw calls onMount once per editor instance and uses the returned
  // function as its teardown. Load the persisted snapshot first, then wire
  // up autosave so the load itself doesn't trigger a redundant write.
  const handleMount = useCallback(
    (editor: Editor) => {
      const snapshot = (initialData as TldrawDiagramData | undefined)?.store;
      const records = snapshot && typeof snapshot === "object" ? (snapshot as { store?: unknown }).store : null;
      const hasRecords = records && typeof records === "object" && Object.keys(records).length > 0;
      if (hasRecords) {
        try {
          editor.loadSnapshot(snapshot as unknown as TLStoreSnapshot);
        } catch {
          // Ignore malformed/legacy snapshots and start from a blank canvas.
        }
      }

      onEditorReady?.(editor);

      if (!onChange) return;

      const unsub = editor.sideEffects.registerOperationCompleteHandler(() => {
        cancelPendingSave();
        const generation = saveGenerationRef.current;
        saveTimer.current = setTimeout(() => {
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          const { document } = editor.getSnapshot();
          onChange({
            type: "tldraw",
            version: 1,
            store: document as unknown as Record<string, unknown>,
          });
        }, SAVE_DEBOUNCE_MS);
      });

      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unsub();
      };
    },
    [cancelPendingSave, initialData, onChange, onEditorReady],
  );

  return (
    <div className="diagram-canvas h-full w-full" style={{ overflow: "hidden" }}>
      <Tldraw
        className="tl-container"
        onMount={handleMount}
        colorScheme={mode === "dark" ? "dark" : "light"}
      />
    </div>
  );
}
