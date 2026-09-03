/**
 * Connections the user added by hand, plus SQLite files found in tracked repos.
 *
 * The core provider — the one that works with no plugin, no AWS account and no
 * VPN. It is also the reason `/db` is worth opening on a fresh install: point it
 * at a `.db` file and you have a working database client.
 *
 * Storage is a JSON file in the app data dir rather than `.env.local`.
 * `DASHBOARD_MANAGED_ENV_KEYS` is a fixed core tuple, so per-connection secrets
 * have nowhere to live there, and a growing list of `DB_CONN_3_PASSWORD` keys
 * would be worse than a file that is structured for the job.
 *
 * Passwords are stored as written. This is a single-user local app whose
 * `.env.local` already holds API tokens in plaintext, so encrypting one file
 * while leaving that one alone would buy nothing but ceremony. The file is
 * created 0600 and never leaves the machine.
 */

import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "@/lib/desktop/runtime-paths";
import { DbConnectionNotFoundError, type DbConnectionProvider } from "./provider";
import type { DbConnectionRef, DbEngine, ResolvedDbConnection } from "./types";

/** Namespace for every id this provider owns. */
export const USER_PROVIDER_ID = "local";

export interface StoredUserConnection {
  /** Slug, unique within this provider. The full id is `local:<slug>`. */
  slug: string;
  label: string;
  engine: DbEngine;
  group?: string;
  /** Postgres */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  /** MongoDB */
  uri?: string;
  /** SQLite */
  file?: string;
  /**
   * Whether this connection may write. Unlike a plugin connection — where the
   * mode is derived from AWS access and is not the user's to choose — a
   * hand-added connection has no external authority to derive from, so the
   * user sets it. Defaults to read-only.
   */
  readOnly?: boolean;
}

interface StoreShape {
  connections: StoredUserConnection[];
}

export function userConnectionsPath(appDataDir: string = getAppDataDir()): string {
  return path.join(appDataDir, "db-connections.json");
}

export function readUserConnections(file = userConnectionsPath()): StoredUserConnection[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as StoreShape;
    return Array.isArray(parsed?.connections) ? parsed.connections : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Could not read saved database connections from ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

export function writeUserConnections(
  connections: StoredUserConnection[],
  file = userConnectionsPath(),
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ connections }, null, 2)}\n`, { mode: 0o600 });
  // An existing file keeps its old mode through writeFileSync, so set it again.
  fs.chmodSync(file, 0o600);
}

/** `local:<slug>` — the id the rest of the system uses. */
export function userConnectionId(slug: string): string {
  return `${USER_PROVIDER_ID}:${slug}`;
}

export function toConnectionRef(stored: StoredUserConnection): DbConnectionRef {
  return {
    id: userConnectionId(stored.slug),
    label: stored.label,
    engine: stored.engine,
    group: stored.group ?? "Local",
    accessMode: stored.readOnly === false ? "write" : "read",
    // Nothing here is derived from an environment, so nothing here is prd. A
    // user pointing this at production still gets the read-only default.
    dangerous: false,
    source: "user",
    unavailable: unavailableReason(stored),
  };
}

function unavailableReason(stored: StoredUserConnection): string | undefined {
  if (stored.engine === "sqlite") {
    if (!stored.file) return "No database file configured.";
    if (!fs.existsSync(stored.file)) return `File not found: ${stored.file}`;
    return undefined;
  }
  if (stored.engine === "mongodb") {
    return stored.uri ? undefined : "No connection URI configured.";
  }
  if (!stored.host) return "No host configured.";
  return undefined;
}

function toResolved(stored: StoredUserConnection): ResolvedDbConnection {
  const accessMode = stored.readOnly === false ? "write" : "read";
  const base = { id: userConnectionId(stored.slug), engine: stored.engine, accessMode, dangerous: false } as const;

  if (stored.engine === "sqlite") {
    if (!stored.file) throw new Error(`'${stored.label}' has no database file configured.`);
    return { ...base, sqlite: { file: stored.file, readOnly: accessMode === "read" } };
  }
  if (stored.engine === "mongodb") {
    if (!stored.uri) throw new Error(`'${stored.label}' has no connection URI configured.`);
    return { ...base, mongodb: { uri: stored.uri, database: stored.database ?? "admin" } };
  }
  if (!stored.host) throw new Error(`'${stored.label}' has no host configured.`);
  return {
    ...base,
    postgres: {
      host: stored.host,
      port: stored.port ?? 5432,
      database: stored.database ?? "postgres",
      user: stored.user ?? "postgres",
      password: stored.password ?? "",
      ssl: stored.ssl ? { rejectUnauthorized: false } : false,
    },
  };
}

export const userConnectionProvider: DbConnectionProvider = {
  id: USER_PROVIDER_ID,

  async list() {
    return readUserConnections().map(toConnectionRef);
  },

  async resolve(id) {
    const slug = id.slice(`${USER_PROVIDER_ID}:`.length);
    const stored = readUserConnections().find((c) => c.slug === slug);
    if (!stored) throw new DbConnectionNotFoundError(id);
    return toResolved(stored);
  },
};
