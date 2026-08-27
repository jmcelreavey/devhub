/**
 * Shared create-or-open helper for notes derived from entities
 * (meetings, tasks, eventually PRs). Path + markdown come from
 * shared/*-note builders; this owns the vault GET/PUT side used by
 * every card's FileText affordance.
 */

import { mutate } from "swr";
import { textToBlocks } from "@/lib/markdown-convert";
import { getVaultClient } from "@/lib/vault/vault-client";

/**
 * SWR key for the shared note-slug index backing every row's "has a note?"
 * badge. Lives here so writing a note can invalidate it without the writer
 * importing UI code.
 */
export const NOTE_INDEX_KEY = "/api/notes-index";

export interface CreateVaultNoteResult {
  path: string;
  href: string;
  /** True when we wrote a new (or overwritten) note. */
  wrote: boolean;
}

export function vaultNoteHref(path: string): string {
  return getVaultClient("notes").paths.pageHref(path);
}

export function vaultNoteApi(path: string): string {
  return `${getVaultClient("notes").apiPrefix}/${path}`;
}

/**
 * Open an existing note at `path`, or create it from `markdown`.
 * When `overwrite` is true, always PUT (legacy meeting regenerate).
 * Prefer open-or-create (default) so cards treat a linked note as durable.
 */
export async function createOrOpenVaultNote(options: {
  path: string;
  markdown: string;
  overwrite?: boolean;
}): Promise<CreateVaultNoteResult> {
  const notes = getVaultClient("notes");
  const api = vaultNoteApi(options.path);
  const href = vaultNoteHref(options.path);

  if (!options.overwrite) {
    const existing = await fetch(api, { cache: "no-store" });
    if (existing.ok) {
      return { path: options.path, href, wrote: false };
    }
  }

  const res = await fetch(api, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: textToBlocks(options.markdown) }),
  });
  if (!res.ok) throw new Error(await res.text());
  notes.paths.notifyTreeChanged();
  // A new slug exists now — refresh the index so open-vs-create labels flip.
  void mutate(NOTE_INDEX_KEY);
  return { path: options.path, href, wrote: true };
}
