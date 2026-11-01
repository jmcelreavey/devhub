import { slugFromNotesPathname } from "@/lib/notes/path";

/** Asks the header Notes panel to open one note in place. */
export const NOTES_OPEN_PATH_EVENT = "devhub:notes-open-path";

export interface NotesOpenPathDetail { path: string }

export function openNoteInPanel(path: string): void {
  window.dispatchEvent(new CustomEvent<NotesOpenPathDetail>(NOTES_OPEN_PATH_EVENT, { detail: { path } }));
}

/** Opens a `/notes/...` href in the Notes panel. Returns false for anything else, so the caller can navigate. */
export function openNoteHrefInPanel(href: string): boolean {
  const slug = slugFromNotesPathname(href.split(/[?#]/)[0] ?? "");
  if (!slug) return false;
  openNoteInPanel(slug);
  return true;
}

/** ⌘/Ctrl/Shift/middle-click keeps the link's full-page behaviour. */
export function wantsFullPage(event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number } | undefined): boolean {
  return !!event && (!!event.metaKey || !!event.ctrlKey || !!event.shiftKey || (event.button ?? 0) !== 0);
}
