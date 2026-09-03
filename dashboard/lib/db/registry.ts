/**
 * The connection registry: every provider, merged, with a cache in front.
 *
 * Two rules, both borrowed from how plugin assets already merge elsewhere in
 * DevHub:
 *
 * 1. **Core wins on collision.** A plugin cannot shadow a user's own saved
 *    connection by claiming its id.
 * 2. **A provider that throws is reported, not fatal.** If the BI plugin cannot
 *    reach `~/.aws/credentials`, the SQLite connections still list. The rail
 *    showing five of six sources with one visible error beats an empty page.
 *
 * The list is cached because the rail refetches it often and `list()` is
 * contractually cheap but not free — the BI provider reads an IAM config that
 * is itself TTL-cached behind `gh api`. The cache is dropped whenever something
 * that changes access changes: an AWS profile switch, a saved-connection edit.
 */

import { PLUGIN_DB_PROVIDERS } from "@/lib/plugin-db-providers.generated";
import {
  DbConnectionNotFoundError,
  type DbConnectionProvider,
  type DbPreflightOptions,
} from "./provider";
import type { DbConnectionRef, DbPreflight, ResolvedDbConnection } from "./types";
import { userConnectionProvider } from "./user-connections";

/** Listing is cheap by contract, but not free — and the rail asks often. */
const LIST_TTL_MS = 30_000;

interface CachedList {
  refs: DbConnectionRef[];
  errors: ProviderError[];
  at: number;
}

export interface ProviderError {
  providerId: string;
  message: string;
}

let cache: CachedList | null = null;

function providers(): DbConnectionProvider[] {
  // Core first: a plugin must not be able to shadow a user's own connection.
  return [userConnectionProvider, ...PLUGIN_DB_PROVIDERS];
}

export interface DbConnectionList {
  connections: DbConnectionRef[];
  /** Providers that failed to list. Surfaced in the rail, not thrown. */
  errors: ProviderError[];
}

export async function listDbConnections(opts?: { refresh?: boolean }): Promise<DbConnectionList> {
  if (!opts?.refresh && cache && Date.now() - cache.at < LIST_TTL_MS) {
    return { connections: cache.refs, errors: cache.errors };
  }

  const refs: DbConnectionRef[] = [];
  const errors: ProviderError[] = [];
  const claimed = new Set<string>();

  // Sequential, not Promise.all: providers shell out, and a stampede of `aws`
  // calls is exactly the pattern the exec registry was built to catch.
  for (const provider of providers()) {
    try {
      for (const ref of await provider.list()) {
        if (claimed.has(ref.id)) continue;
        claimed.add(ref.id);
        refs.push(ref);
      }
    } catch (err) {
      errors.push({ providerId: provider.id, message: (err as Error).message });
    }
  }

  cache = { refs, errors, at: Date.now() };
  return { connections: refs, errors };
}

/**
 * Drop cached listings and ask providers to drop theirs.
 *
 * Called when the AWS profile changes — the whole point of deriving connections
 * from access is that they follow the access, and a stale list after a
 * `dev` → `prd+` switch would offer connections that no longer resolve.
 */
export function invalidateDbConnections(): void {
  cache = null;
  for (const provider of providers()) provider.invalidate?.();
}

function providerFor(connectionId: string): DbConnectionProvider {
  const namespace = connectionId.split(":")[0];
  const match = providers().find((p) => p.id === namespace);
  if (!match) throw new DbConnectionNotFoundError(connectionId);
  return match;
}

export async function findDbConnection(connectionId: string): Promise<DbConnectionRef | null> {
  const { connections } = await listDbConnections();
  return connections.find((c) => c.id === connectionId) ?? null;
}

/** Credentials for a connection. Server-side only — never serialize the result. */
export async function resolveDbConnection(connectionId: string): Promise<ResolvedDbConnection> {
  return providerFor(connectionId).resolve(connectionId);
}

export async function preflightDbConnection(
  connectionId: string,
  options?: DbPreflightOptions,
): Promise<DbPreflight> {
  const provider = providerFor(connectionId);
  if (!provider.preflight) return { ok: true, checks: [] };
  return provider.preflight(connectionId, options);
}

/** Tests only. */
export function resetDbRegistry(): void {
  cache = null;
}
