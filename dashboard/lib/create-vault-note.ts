/**
 * Shared create-or-open helper for notes derived from entities
 * (meetings, tasks). Path + markdown come from shared/*-note builders;
 * this owns the vault PUT / navigate side used by the dashboard buttons.
 */

import { textToBlocks } from "@/lib/markdown-convert";
import { getVaultClient } from "@/lib/vault/vault-client";

export interface CreateVaultNoteResult {
  path: string;
  href: string;
  /** True when we wrote a new (or overwritten) note. */
  wrote: boolean;
}

/**
 * Open an existing note at `path`, or create it from `markdown`.
 * When `overwrite` is true (meeting-note legacy behaviour), always PUT.
 */
export async function createOrOpenVaultNote(options: {
  path: string;
  markdown: string;
  overwrite?: boolean;
}): Promise<CreateVaultNoteResult> {
  const notes = getVaultClient("notes");
  const api = `${notes.apiPrefix}/${options.path}`;
  const href = notes.paths.pageHref(options.path);

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
