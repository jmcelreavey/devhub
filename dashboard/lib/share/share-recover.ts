import { fetchGistMarkdown } from "@/lib/share/gist";
import {
  hashMarkdown,
  readShareSource,
  vaultContentFromShareMarkdown,
} from "@/lib/share/share-content";
import { getShare, upsertShare } from "@/lib/share/share-store";
import { shareExpiresAt, type ShareRecord, type VaultId } from "@/lib/share/share-public";
import { getVaultStorage } from "@/lib/vault/vault-registry";

export class ShareRecoverError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShareRecoverError";
  }
}

export interface RecoverShareOptions {
  fetchMarkdown?: (gistId: string) => Promise<string>;
  now?: number;
}

function sourceOccupied(vault: VaultId, sharePath: string): boolean {
  const storage = getVaultStorage(vault);
  try {
    return storage.readRaw(sharePath) !== null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Path traversal")) {
      throw new ShareRecoverError("Path traversal blocked", 400);
    }
    // Directory / unreadable path — do not clobber.
    return true;
  }
}

async function loadGistMarkdown(
  gistId: string,
  fetchMarkdown: (gistId: string) => Promise<string>,
): Promise<string> {
  try {
    return await fetchMarkdown(gistId);
  } catch (err) {
    if (err instanceof ShareRecoverError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(message)) {
      throw new ShareRecoverError("Gist not found", 404);
    }
    throw err;
  }
}

/**
 * Restore a deleted note/doc/diagram from its still-live gist.
 *
 * Writes back to the share record's original vault path. Does not create or
 * edit the gist — the existing URL stays attached via the same registry key.
 */
export async function recoverShareFromGist(
  vault: VaultId,
  sharePath: string,
  options: RecoverShareOptions = {},
): Promise<ShareRecord> {
  const share = getShare(vault, sharePath);
  if (!share) {
    throw new ShareRecoverError("Not shared", 404);
  }

  const now = options.now ?? Date.now();
  if (now >= shareExpiresAt(share)) {
    throw new ShareRecoverError("This live link has expired", 410);
  }

  if (sourceOccupied(vault, sharePath)) {
    throw new ShareRecoverError(
      "A file already exists at this path — recover will not overwrite it",
      409,
    );
  }

  const markdown = await loadGistMarkdown(share.gistId, options.fetchMarkdown ?? fetchGistMarkdown);
  if (!markdown.trim()) {
    throw new ShareRecoverError("Gist is empty", 400);
  }

  let content: unknown;
  try {
    content = vaultContentFromShareMarkdown(vault, sharePath, markdown);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse gist content";
    throw new ShareRecoverError(message, 400);
  }

  const storage = getVaultStorage(vault);
  try {
    storage.write(sharePath, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Path traversal")) {
      throw new ShareRecoverError("Path traversal blocked", 400);
    }
    throw new ShareRecoverError(message || "Failed to write source", 500);
  }

  const restored = readShareSource(vault, sharePath);
  if (!restored) {
    throw new ShareRecoverError("Failed to write source", 500);
  }

  // Keep gistId/url/createdAt. Refresh the hash so the row isn't stale after
  // a notes markdown → blocks round-trip; we did not push to the gist.
  return upsertShare({
    ...share,
    contentHash: hashMarkdown(restored.markdown),
  });
}
