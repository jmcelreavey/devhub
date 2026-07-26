import { VAULT_PUBLIC } from "@/lib/vault/vault-public";

const notes = VAULT_PUBLIC.notes.paths;

/** Slug without `.json`, forward slashes only. */
export const normalizeNoteSlug = notes.normalizeSlug;

/** Decode `/notes/a/b` → `a/b`; null when not a note detail route. */
export const slugFromNotesPathname = notes.slugFromPathname;

export const notesPageHref = notes.pageHref;

export const isNotesPageActive = notes.isPageActive;

export const notesApiPathFromSlug = notes.apiPathFromSlug;

export const buildRenamedNotePath = notes.buildRenamedPath;

export const NOTES_TREE_REFRESH_EVENT = notes.treeRefreshEvent;

export const notifyNotesTreeChanged = notes.notifyTreeChanged;

export const renameNoteFile = notes.renameFile;
