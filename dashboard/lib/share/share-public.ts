import type { VaultId } from "@/lib/vault/vault-public";

export type { VaultId };

/** A note/doc currently published as a secret GitHub Gist. */
export interface ShareRecord {
  /** Stable key: `${vault}:${path}`. */
  key: string;
  vault: VaultId;
  /** Decoded vault slug (no extension), e.g. `projects/garden`. */
  path: string;
  /** Display title (last path segment when shared). */
  title: string;
  gistId: string;
  /** Human-facing gist URL. */
  url: string;
  /** Epoch ms when the share was created. */
  createdAt: number;
  /** Epoch ms of the last content push to the gist. */
  updatedAt: number;
  /** sha256 of the markdown last pushed to the gist; used to detect drift. */
  contentHash: string;
}

/** A share plus live drift status, computed per request (never persisted). */
export interface ShareStatus extends ShareRecord {
  /** The note has changed since it was last pushed (or the source is gone). */
  stale: boolean;
  /** The underlying note/doc no longer exists on disk. */
  missing: boolean;
}

export function shareKey(vault: VaultId, path: string): string {
  return `${vault}:${path}`;
}

/** Live links auto-expire this long after they are first published. */
export const SHARE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Epoch ms when a share auto-expires. */
export function shareExpiresAt(share: Pick<ShareRecord, "createdAt">): number {
  return share.createdAt + SHARE_TTL_MS;
}
