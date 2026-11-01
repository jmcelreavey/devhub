/**
 * The connection registry: every provider, merged, with a cache in front.
 *
 * Two rules, both borrowed from how plugin assets already merge elsewhere in
 * DevHub:
 *
 * 1. **Core wins on collision.** A plugin cannot shadow a user's own saved
 *    connection by claiming its id.
 * 2. **A provider that throws is reported, not fatal.** If the plugin plugin cannot
 *    reach `~/.aws/credentials`, the SQLite connections still list. The rail
 *    showing five of six sources with one visible error beats an empty page.
 *
 * The list is cached because the rail refetches it often and `list()` is
 * contractually cheap but not free — the plugin provider reads an IAM config that
 * is itself TTL-cached behind `gh api`. The cache is dropped whenever something
 * that changes access changes: an AWS profile switch, a saved-connection edit.
 */

import {
  DbConnectionNotFoundError,
  type DbConnectionProvider,
  type DbPreflightOptions,
} from "./provider";
import type { DbConnectionRef, DbPreflight, ResolvedDbConnection } from "./types";
import { userConnectionProvider } from "./user-connections";
import { runtimeDbProviders } from "./runtime-provider";
import { emitCoreEvent } from "../../domains/events/core-events";

/** Listing is cheap by contract, but not free — and the rail asks often. */
const LIST_TTL_MS = 30_000;

interface CachedList {
  refs: DbConnectionRef[];
  errors: ProviderError[];
  at: number;
  runtimeKey: string;
}

export interface ProviderError {
  providerId: string;
  message: string;
}

let cache: CachedList | null = null;
let generation = 0;
let invalidating: Promise<void> | null = null;

function providers(runtime = runtimeDbProviders()): DbConnectionProvider[] {
  // Core first: a plugin must not be able to shadow a user's own connection.
  const claimed = new Set<string>();
  return [userConnectionProvider, ...runtime.providers].filter((provider) => {
    if (claimed.has(provider.id)) return false;
    claimed.add(provider.id);
    return true;
  });
}

export interface DbConnectionList {
  connections: DbConnectionRef[];
  /** Providers that failed to list. Surfaced in the rail, not thrown. */
  errors: ProviderError[];
}

export async function listExternalDbConnections(opts?: { refresh?: boolean }): Promise<DbConnectionList> {
  if (invalidating) await invalidating;
  const runtime = runtimeDbProviders();
  const started = generation;
  if (!opts?.refresh && cache && cache.runtimeKey === runtime.key && Date.now() - cache.at < LIST_TTL_MS) {
    return { connections: cache.refs, errors: cache.errors };
  }

  const refs: DbConnectionRef[] = [];
  const errors: ProviderError[] = [];
  const claimed = new Set<string>();

  // Sequential, not Promise.all: providers shell out, and a stampede of `aws`
  // calls is exactly the pattern the exec registry was built to catch.
  for (const provider of providers(runtime).filter((provider) => provider.id !== userConnectionProvider.id)) {
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

  if (started === generation) cache = { refs, errors, at: Date.now(), runtimeKey: runtime.key };
  return { connections: refs, errors };
}

export async function listDbConnections(opts?: { refresh?: boolean }): Promise<DbConnectionList> {
  const remote = await listExternalDbConnections(opts);
  let local: DbConnectionRef[] = [];
  const errors = [...remote.errors];
  try {
    local = await userConnectionProvider.list();
  } catch (err) {
    errors.unshift({ providerId: userConnectionProvider.id, message: (err as Error).message });
  }
  const claimed = new Set(local.map((ref) => ref.id));
  return { connections: [...local, ...remote.connections.filter((ref) => !claimed.has(ref.id))], errors };
}

/**
 * Drop cached listings and ask providers to drop theirs.
 *
 * Called when the AWS profile changes — the whole point of deriving connections
 * from access is that they follow the access, and a stale list after a
 * `dev` → `prd+` switch would offer connections that no longer resolve.
 */
export async function invalidateDbConnections(): Promise<void> {
  generation++;
  cache = null;
  emitCoreEvent("db");
  const pending = Promise.all(providers().map((provider) => provider.invalidate?.())).then(() => undefined);
  invalidating = pending;
  try { await pending; }
  finally { if (invalidating === pending) invalidating = null; }
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
  if (invalidating) await invalidating;
  return providerFor(connectionId).resolve(connectionId);
}

export async function preflightDbConnection(
  connectionId: string,
  options?: DbPreflightOptions,
): Promise<DbPreflight> {
  if (invalidating) await invalidating;
  const provider = providerFor(connectionId);
  if (!provider.preflight) return { ok: true, checks: [] };
  return provider.preflight(connectionId, options);
}

/** Tests only. */
export function resetDbRegistry(): void {
  cache = null;
}
