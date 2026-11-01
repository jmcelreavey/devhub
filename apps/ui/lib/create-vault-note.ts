/**
 * Shared create-or-open helper for notes derived from entities
 * (meetings, tasks, eventually PRs). Path + markdown come from
 * shared/*-note builders; this owns the vault GET/PUT side used by
 * every card's FileText affordance.
 */

import { mutate } from "swr";
import { textToBlocks } from "../../../packages/shared/ui-lib/markdown-convert";
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

  const existing = await fetch(api, { cache: "no-store" });
  if (!existing.ok && existing.status !== 404) throw new Error(await existing.text());
  if (existing.ok && !options.overwrite) return { path: options.path, href, wrote: false };
  const expectedRevision: unknown = existing.ok ? (await existing.json()).revision : null;
  if (expectedRevision !== null && typeof expectedRevision !== "string") throw new Error("Note revision is unavailable. Reload and try again.");

  const res = await fetch(api, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: textToBlocks(options.markdown), expectedRevision }),
  });
  if (!res.ok) throw new Error(await res.text());
  notes.paths.notifyTreeChanged();
  // A new slug exists now — refresh the index so open-vs-create labels flip.
  void mutate(NOTE_INDEX_KEY);
  return { path: options.path, href, wrote: true };
}
