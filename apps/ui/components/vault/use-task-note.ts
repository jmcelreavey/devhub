"use client";

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
import { prepareTaskNoteBlocks } from "../../../../packages/shared/ui-lib/notes/prepare-task-note";
import { sameFreeform } from "@/lib/notes/task-note-edit";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";
import { isTaskNotePath, readTaskNote, splitTaskNote } from "@shared/task-note/sections.ts";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type Blocks = DevHubPartialBlock[];

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
  /** The page's save status; remote updates wait while a save is pending or has failed. */
  statusRef: MutableRefObject<SaveStatus>;
  /** The page's editor-remount counter: bumping it remounts the editor on `blocks`. */
  setEditorEpoch: (update: (epoch: number) => number) => void;
}

/**
 * The view side of a task note on the editor page. the user edits the free-form blocks in
 * BlockNote while agents rewrite the standard sections through the API, so the editor only
 * ever holds the free-form blocks (see `lib/notes/task-note-edit.ts` for folding edits back
 * into the whole note and `task-note-merge.ts` for the save-time merge), and an open note
 * refreshes on agent changes.
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
  const visible = usePanelVisible();
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
   * Agents rewrite a task note's sections while it is open. Check for a newer version
   * and pull it in once nothing of ours is waiting: sections update in place, and the editor
   * only remounts if the free-form content itself changed underneath. A failed save keeps
   * our unsaved edits; they are never replaced.
   */
  const loaded = blocks !== null;
  useEffect(() => {
    if (!enabled || !visible || isNew || !loaded) return;
    let stopped = false;
    let running = false;
    let dirty = false;
    let retryDelay = 1_000;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const busy = () => statusRef.current === "saving" || statusRef.current === "error";
    const schedule = () => {
      if (stopped || retry) return;
      retry = setTimeout(() => {
        retry = undefined;
        void tick();
      }, retryDelay);
    };
    const tick = async () => {
      if (stopped) return;
      dirty = true;
      if (running || document.visibilityState !== "visible" || statusRef.current === "error") return;
      if (statusRef.current === "saving") return schedule();
      clearTimeout(retry);
      retry = undefined;
      running = true;
      dirty = false;
      let failed = false;
      const originalModified = sourceModifiedRef.current;
      try {
        const probe = await fetch(`/api/tasks/note/sections?notePath=${encodeURIComponent(filePath)}&probe=1`);
        if (!probe.ok) {
          failed = probe.status !== 404;
          return;
        }
        const { modified } = (await probe.json()) as { modified?: number };
        if (stopped || typeof modified !== "number" || modified === sourceModifiedRef.current) return;
        const res = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`);
        if (!res.ok) {
          failed = res.status !== 404;
          return;
        }
        const remote = (await res.json()) as { content?: unknown; modified?: number };
        if (stopped) return;
        if (busy() || originalModified !== sourceModifiedRef.current) {
          dirty = true;
          return;
        }
        if (!Array.isArray(remote.content) || typeof remote.modified !== "number") return;
        const next = prepareTaskNoteBlocks(remote.content);
        const local = latestBlocksRef.current;
        const unchangedFreeform = !!local && sameFreeform(local, next);
        setSourceModified(remote.modified);
        latestBlocksRef.current = next;
        setBlocks(next);
        if (!unchangedFreeform || sourceMode) setEditorEpoch((epoch) => epoch + 1);
      } catch {
        failed = true;
      } finally {
        running = false;
        retryDelay = failed ? Math.min(retryDelay * 2, 30_000) : 1_000;
        if (dirty || failed) schedule();
      }
    };
    const unsubscribe = subscribeToTaskEvents({
      domains: ["notes"],
      connection: () => {},
      refresh: () => { void tick(); },
    });
    void tick();
    return () => {
      stopped = true;
      clearTimeout(retry);
      unsubscribe();
    };
  }, [enabled, visible, filePath, isNew, latestBlocksRef, loaded, setBlocks, setEditorEpoch, setSourceModified, sourceMode, sourceModifiedRef, statusRef, apiPrefix, paths]);

  return { isTaskNote: enabled, sourceMode, view, editorBlocks, toggleSource };
}
