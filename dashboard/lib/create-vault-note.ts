/**
 * Shared create-or-open helper for notes derived from entities
 * (meetings, tasks, eventually PRs). Path + markdown come from
 * shared/*-note builders; this owns the vault GET/PUT side used by
 * every card's FileText affordance.
 */

import { textToBlocks } from "@/lib/markdown-convert";
import { getVaultClient } from "@/lib/vault/vault-client";

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

/** Cheap existence check for card badges / open-vs-create labels. */
export async function vaultNoteExists(path: string): Promise<boolean> {
  const res = await fetch(vaultNoteApi(path), { cache: "no-store" });
  return res.ok;
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
  return { path: options.path, href, wrote: true };
}
