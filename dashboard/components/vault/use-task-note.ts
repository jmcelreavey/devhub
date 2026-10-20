"use client";

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
import { prepareTaskNoteBlocks } from "@/lib/notes/prepare-task-note";
import { sameFreeform } from "@/lib/notes/task-note-edit";
import { isTaskNotePath, readTaskNote, splitTaskNote } from "@shared/task-note/sections.ts";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type Blocks = DevHubPartialBlock[];

/** How often an open task note checks whether an agent changed it. */
const POLL_MS = 4000;

export interface UseTaskNoteOptions {
  /** Whether this is the notes vault; only notes under task-notes/ get the visual page, every other note passes straight through. */
  isNotes: boolean;
  filePath: string;
  /** Where the note lives: `${apiPrefix}/${paths.apiPathFromSlug(filePath)}`. */
  apiPrefix: string;
  paths: { apiPathFromSlug: (slug: string) => string };
  isNew: boolean;
  /** The note as currently shown. */
  blocks: Blocks | null;
  setBlocks: (blocks: Blocks) => void;
  /** The whole note as last edited or received. Free-form edits update it without re-rendering; the page owns it. */
  latestBlocksRef: MutableRefObject<Blocks | null>;
  /** `modified` of the version we last loaded or saved; owned by the page, which sends it with saves. */
  sourceModifiedRef: MutableRefObject<number | null>;
  setSourceModified: (modified: number | null) => void;
  /** The page's save status; polling waits while a save is pending and while one has failed. */
  statusRef: MutableRefObject<SaveStatus>;
  /** The page's editor-remount counter: bumping it remounts the editor on `blocks`. */
  setEditorEpoch: (update: (epoch: number) => number) => void;
}

/**
 * The view side of a task note on the editor page. John edits the free-form blocks in
 * BlockNote while agents rewrite the standard sections through the API, so the editor only
 * ever holds the free-form blocks (see `lib/notes/task-note-edit.ts` for folding edits back
 * into the whole note and `task-note-merge.ts` for the save-time merge), and an open note
 * polls for agent changes.
 */
export function useTaskNote({
  isNotes,
  filePath,
  apiPrefix,
  paths,
  isNew,
  blocks,
  setBlocks,
  latestBlocksRef,
  sourceModifiedRef,
  setSourceModified,
  statusRef,
  setEditorEpoch,
}: UseTaskNoteOptions) {
  // Derived here, not in the page: computing it there makes the React Compiler skip the whole page component.
  const enabled = isNotes && isTaskNotePath(filePath);
  /** Source mode puts the whole note in the editor; keyed by path so navigating resets it. */
  const [sourceModePath, setSourceModePath] = useState<string | null>(null);
  const sourceMode = sourceModePath === filePath;

  const view = useMemo(() => (enabled && blocks ? readTaskNote(blocks as unknown[]) : null), [blocks, enabled]);

  /** What the editor opens with: free-form blocks only in the visual note, else the whole note. */
  const editorBlocks = useMemo(
    () => (enabled && !sourceMode && blocks ? (splitTaskNote(blocks as unknown[]).freeform as Blocks) : blocks),
    [blocks, enabled, sourceMode],
  );

  const toggleSource = useCallback(() => {
    // Remount the editor on the current content: the whole note in source mode, free-form only in view mode.
    if (latestBlocksRef.current) setBlocks(latestBlocksRef.current);
    setSourceModePath(sourceMode ? null : filePath);
    setEditorEpoch((epoch) => epoch + 1);
  }, [filePath, latestBlocksRef, setBlocks, setEditorEpoch, sourceMode]);

  /**
   * Agents rewrite a task note's sections while it is open. Poll cheaply for a newer version
   * and pull it in once nothing of ours is waiting: sections update in place, and the editor
   * only remounts if the free-form content itself changed underneath. A failed save keeps
   * our unsaved edits; they are never replaced.
   */
  const loaded = blocks !== null;
  useEffect(() => {
    if (!enabled || isNew || !loaded) return;
    let stopped = false;
    const busy = () => statusRef.current === "saving" || statusRef.current === "error";
    const tick = async () => {
      if (document.visibilityState !== "visible" || busy()) return;
      try {
        const probe = await fetch(`/api/tasks/note/sections?notePath=${encodeURIComponent(filePath)}&probe=1`);
        if (!probe.ok) return;
        const { modified } = (await probe.json()) as { modified?: number };
        if (stopped || typeof modified !== "number" || modified === sourceModifiedRef.current) return;
        const res = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`);
        if (!res.ok || stopped || busy()) return;
        const remote = (await res.json()) as { content?: unknown; modified?: number };
        if (!Array.isArray(remote.content) || typeof remote.modified !== "number") return;
        const next = prepareTaskNoteBlocks(remote.content);
        const local = latestBlocksRef.current;
        const unchangedFreeform = !!local && sameFreeform(local, next);
        setSourceModified(remote.modified);
        latestBlocksRef.current = next;
        setBlocks(next);
        if (!unchangedFreeform || sourceMode) setEditorEpoch((epoch) => epoch + 1);
      } catch {
        // offline or mid-save: the next tick tries again
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled, filePath, isNew, latestBlocksRef, loaded, setBlocks, setEditorEpoch, setSourceModified, sourceMode, sourceModifiedRef, statusRef, apiPrefix, paths]);

  return { isTaskNote: enabled, sourceMode, view, editorBlocks, toggleSource };
}
