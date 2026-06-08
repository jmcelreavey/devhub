"use client";

import { useEffect } from "react";

export const NOTE_AUTOSAVE_INVALIDATE_EVENT = "devhub:note-autosave-invalidate";
const NOTE_AUTOSAVE_CHANNEL = "devhub-note-autosave";

export interface NoteAutosaveInvalidateDetail {
  slug: string;
}

export interface NoteAutosaveTreeEntry {
  type: "dir" | "file";
  path: string;
  children?: NoteAutosaveTreeEntry[];
}

/** Collect note slugs under a sidebar tree entry (for folder delete invalidation). */
export function collectTreeNoteSlugs(
  entry: NoteAutosaveTreeEntry,
  normalizeSlug: (path: string) => string,
): string[] {
  if (entry.type === "file") return [normalizeSlug(entry.path)];
  if (!entry.children?.length) return [];
  return entry.children.flatMap((child) => collectTreeNoteSlugs(child, normalizeSlug));
}

function normalizeSlug(slug: string): string {
  return slug.replace(/\\/g, "/");
}

/** Cancel debounced saves targeting `slug` in this tab and others (rename/move/delete). */
export function broadcastNoteAutosaveInvalidation(slug: string): void {
  if (typeof window === "undefined") return;
  const detail: NoteAutosaveInvalidateDetail = { slug: normalizeSlug(slug) };
  window.dispatchEvent(
    new CustomEvent<NoteAutosaveInvalidateDetail>(NOTE_AUTOSAVE_INVALIDATE_EVENT, { detail }),
  );
  try {
    new BroadcastChannel(NOTE_AUTOSAVE_CHANNEL).postMessage(detail);
  } catch {
    /* BroadcastChannel unavailable */
  }
}

/** Invalidate the editor autosave when another UI surface renames the open note. */
export function useNoteAutosaveInvalidationListener(
  filePath: string | undefined,
  onInvalidate: () => void,
): void {
  useEffect(() => {
    if (typeof window === "undefined" || !filePath) return;
    const normalizedPath = normalizeSlug(filePath);

    const handleSlug = (slug: string | undefined) => {
      if (slug && normalizeSlug(slug) === normalizedPath) onInvalidate();
    };

    const onWindowEvent = (event: Event) => {
      handleSlug((event as CustomEvent<NoteAutosaveInvalidateDetail>).detail?.slug);
    };

    window.addEventListener(NOTE_AUTOSAVE_INVALIDATE_EVENT, onWindowEvent);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(NOTE_AUTOSAVE_CHANNEL);
      channel.onmessage = (message) => {
        handleSlug((message.data as NoteAutosaveInvalidateDetail | undefined)?.slug);
      };
    } catch {
      /* ignore */
    }

    return () => {
      window.removeEventListener(NOTE_AUTOSAVE_INVALIDATE_EVENT, onWindowEvent);
      channel?.close();
    };
  }, [filePath, onInvalidate]);
}
