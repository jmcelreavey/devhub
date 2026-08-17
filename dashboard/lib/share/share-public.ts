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

/**
 * A note published as a one-time PrivateBin link.
 *
 * Deliberately *not* a `ShareRecord`. A gist share is a stable URL we keep in
 * sync with the note, so "stale" and "update" mean something. A one-time link
 * is consumed on first read: there is nothing to update, the URL changes on
 * every publish, and after the recipient opens it the content is gone from the
 * server entirely. Modelling both with one type produced a `/shared` page that
 * offered Update buttons that could not work.
 *
 * We cannot observe whether it has been read — that is the server's business
 * and it tells nobody — so this record is a local receipt, not a status.
 */
export interface OneTimeRecord {
  /**
   * Local receipt id — our handle for revoke, not the paste id.
   * The registry is a secret store (see `url`). The passphrase is the only
   * secret that is never written here.
   */
  id: string;
  vault: VaultId;
  /** Decoded vault slug (no extension) the link was made from. */
  path: string;
  title: string;
  /**
   * Full PrivateBin URL, key fragment included. Re-copy needs that fragment —
   * without it the paste is ciphertext you cannot decrypt — so this registry
   * is a secret store, not a public index. The passphrase is the only thing
   * we never persist.
   */
  url: string;
  pasteId: string;
  /** Lets us revoke before first read. Useless afterwards. */
  deleteToken: string;
  hasPassword: boolean;
  burnAfterReading: boolean;
  /** PrivateBin expiry key, e.g. `1day`. */
  expire: string;
  createdAt: number;
  /** Epoch ms the instance will drop it, mirrored locally for display only. */
  expiresAt: number;
}

/** One-time links we no longer need to show, because the server dropped them. */
export function oneTimeIsExpired(record: Pick<OneTimeRecord, "expiresAt">, now = Date.now()): boolean {
  return now >= record.expiresAt;
}
