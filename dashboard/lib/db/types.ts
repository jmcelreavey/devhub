/**
 * Shared vocabulary for the database client.
 *
 * Pure — no Node imports — so client components can import it. The rule that
 * shapes this file: **a `DbConnectionRef` is safe to send to the browser and a
 * `ResolvedDbConnection` never is.** The first says what you could connect to;
 * the second holds the host, username and password to do it. The UI works
 * entirely in ids, and credentials stay in the dashboard process.
 */

export type DbEngine = "postgres" | "mongodb" | "sqlite";

/** What the connection is allowed to do, derived from the caller's access, not chosen by them. */
export type DbAccessMode = "read" | "write";

/** Sidebar stripe colour. Deliberately semantic, not a colour name — themes own the palette. */
export type DbEnvTone = "neutral" | "accent" | "warning" | "danger";

/**
 * A connection that could be opened. Cheap to enumerate: no network call, no
 * credential fetch, no AWS shell-out. Listing must stay cheap because the rail
 * renders it on every page load.
 */
export interface DbConnectionRef {
  /** Stable and provider-namespaced, e.g. `bi:rds:capi:prd`, `local:insider-cache`. */
  id: string;
  label: string;
  engine: DbEngine;
  /** Database bound by a single-database connection such as MongoDB. Safe metadata, not credentials. */
  database?: string;
  /** Rail grouping header, e.g. "BI · prd". */
  group?: string;
  /** Environment name when the provider has one; drives `tone`. */
  env?: string;
  tone?: DbEnvTone;
  accessMode: DbAccessMode;
  /**
   * Writes here need a typed confirmation naming the connection. Set by the
   * provider — for BI this is `isDangerousProfile()`, i.e. prd + privileged.
   */
  dangerous: boolean;
  source: "user" | `plugin:${string}`;
  /**
   * Why this cannot be opened right now, in prose the user can act on
   * ("Tailscale is not running"). Present means the row renders dimmed.
   */
  unavailable?: string;
  /**
   * A one-click fix for {@link unavailable}.
   *
   * The difference between a connection you can see and a connection you can
   * use. Listing every database you have IAM for is only half the job — most of
   * them need an AWS profile you are not currently signed into, and "go to Ops,
   * find the right profile, come back" is three clicks and a lost train of
   * thought. The provider says what would fix it; the UI offers the button.
   *
   * Deliberately generic: an endpoint and a body, not an AWS concept, so core
   * carries no knowledge of what any particular provider needs.
   */
  remedy?: DbRemedy;
  /**
   * Epoch ms when the credentials behind this connection stop working.
   *
   * Surfaced so the rail can warn *before* the failure. Every BI connection
   * dies at the same moment each day and the current experience is to find out
   * by clicking one — which is a worse way to learn it than a countdown that
   * was there all along.
   */
  credentialsExpireAt?: number;
}

/**
 * A one-click fix for something that is blocking a connection.
 *
 * Deliberately generic — an endpoint and a body, not an AWS or Tailscale
 * concept — so core carries no knowledge of what any provider needs, and the UI
 * and the MCP tools can both apply one without a special case per provider.
 */
export interface DbRemedy {
  /** Stable id, so an agent can name the fix it is about to apply. */
  id: string;
  /** Button text, e.g. "Switch to dev-dad" or "Bring Tailscale up". */
  label: string;
  /** Dashboard path to POST to. */
  endpoint: string;
  body?: Record<string, unknown>;
  /** Shown while it runs, e.g. "Signing in…". */
  pendingLabel?: string;
  /**
   * True when applying this changes something beyond the database session —
   * machine network state, or which AWS role you hold. The UI still asks with a
   * button; the MCP requires `confirm: true`.
   */
  affectsMachineState?: boolean;
}

/** Readiness of the machine-level prerequisites, before we try to open a socket. */
export interface DbPreflightCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
  /**
   * How to fix *this* check.
   *
   * Attached per check rather than per connection because the two things that
   * block a BI connection — the wrong AWS profile and a down tailnet — have
   * different fixes and can fail independently. A single connection-level
   * remedy could only ever address one of them.
   */
  remedy?: DbRemedy;
}

export interface DbPreflight {
  ok: boolean;
  checks: DbPreflightCheck[];
}

/** Postgres connection parameters. Server-side only. */
export interface PostgresTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /**
   * RDS presents an Amazon-issued cert that the default trust store rejects.
   * `bi-rds.ts` already connects with `rejectUnauthorized: false`, which is
   * what `sslmode=require` means: encrypted, not verified.
   */
  ssl: boolean | { rejectUnauthorized: boolean };
}

/** MongoDB connection parameters. The URI embeds SigV4 credentials — server-side only. */
export interface MongoTarget {
  uri: string;
  database: string;
}

/** SQLite connection parameters. */
export interface SqliteTarget {
  file: string;
  readOnly: boolean;
}

/**
 * A connection with its credentials resolved. **Never serialize this to the
 * client.** Held only by the pool.
 */
export interface ResolvedDbConnection {
  id: string;
  engine: DbEngine;
  accessMode: DbAccessMode;
  dangerous: boolean;
  postgres?: PostgresTarget;
  mongodb?: MongoTarget;
  sqlite?: SqliteTarget;
  /**
   * Epoch ms after which these credentials will not authenticate a *new*
   * connection. RDS IAM tokens last 15 minutes and Atlas rides STS session
   * credentials. Already-open sockets survive — both engines authenticate at
   * connect time only — so the pool re-resolves lazily rather than tearing a
   * working session down on a timer.
   */
  expiresAt?: number;
}

/** One column of a result set. */
export interface DbColumn {
  name: string;
  /** Engine-native type name, shown in the grid header. */
  dataType?: string;
}

export interface DbResultSet {
  columns: DbColumn[];
  /** Row values as JSON-safe primitives; complex types are stringified by the adapter. */
  rows: unknown[][];
  /** Rows affected by a mutation, when the engine reports one. */
  rowsAffected?: number;
  /** True when the row cap trimmed the result — the grid must say so. */
  truncated: boolean;
  durationMs: number;
  /** Echoed back so the history entry and the grid agree on what ran. */
  statement: string;
}

/**
 * Default ceiling on rows pulled into memory. A `SELECT *` against a prd table
 * is a routine mistake, and the failure mode without a cap is the dashboard
 * process, not the query.
 */
export const DB_DEFAULT_ROW_LIMIT = 500;
export const DB_MAX_ROW_LIMIT = 50_000;
