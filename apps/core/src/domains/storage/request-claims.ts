import { Pool } from "pg";
import type { RequestClaimStore } from "../../../../../packages/shared/storage/request-claims";
import { sqliteClaim, sqliteReadClaim, sqliteReleaseClaim } from "./runs";

export function sqliteRequestClaims(root: string): RequestClaimStore {
  return {
    read: async (hash) => sqliteReadClaim(root, hash),
    claim: async (hash, runId) => sqliteClaim(root, hash, runId),
    release: async (hash, runId) => sqliteReleaseClaim(root, hash, runId),
  };
}

/** A workspace is an explicit owner, not a user account or an authorisation check. */
export function postgresRequestClaims(pool: Pool, workspaceId: string): RequestClaimStore {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(workspaceId)) throw new Error("A valid workspaceId is required for Postgres storage");
  let ready: Promise<unknown> | undefined;
  const initialise = () => ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // IF NOT EXISTS alone races on Postgres' catalogue during concurrent first boots.
      await client.query("SELECT pg_advisory_xact_lock(73480126)");
      await client.query(`CREATE TABLE IF NOT EXISTS devhub_request_claims (
        workspace_id TEXT NOT NULL, hash TEXT NOT NULL, run_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, hash)
      )`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  })().catch((error: unknown) => { ready = undefined; throw error; });
  const validate = (hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid request hash");
  };
  return {
    async read(hash) {
      validate(hash);
      await initialise();
      const result = await pool.query<{ run_id: string }>(
        "SELECT run_id FROM devhub_request_claims WHERE workspace_id = $1 AND hash = $2", [workspaceId, hash],
      );
      return result.rows[0]?.run_id ?? null;
    },
    async claim(hash, runId) {
      validate(hash);
      if (!/^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/.test(runId)) throw new Error("Invalid run id");
      await initialise();
      const result = await pool.query<{ run_id: string }>(`
        INSERT INTO devhub_request_claims (workspace_id, hash, run_id) VALUES ($1, $2, $3)
        ON CONFLICT (workspace_id, hash) DO UPDATE SET run_id = devhub_request_claims.run_id
        RETURNING run_id
      `, [workspaceId, hash, runId]);
      return result.rows[0].run_id;
    },
    async release(hash, runId) {
      validate(hash);
      await initialise();
      await pool.query(
        "DELETE FROM devhub_request_claims WHERE workspace_id = $1 AND hash = $2 AND run_id = $3", [workspaceId, hash, runId],
      );
    },
  };
}

let configured: { url: string; workspaceId: string; pool: Pool; store: RequestClaimStore } | undefined;

/** Explicit opt-in only; never fall back to another backend after a DB failure. */
export function requestClaimStorage(root: string): RequestClaimStore {
  const url = process.env.DEVHUB_STORAGE_URL;
  if (!url) return sqliteRequestClaims(root);
  const workspaceId = process.env.DEVHUB_WORKSPACE_ID ?? "";
  if (configured) {
    if (configured.url !== url || configured.workspaceId !== workspaceId) throw new Error("Restart core after changing storage configuration");
    return configured.store;
  }
  let protocol: string;
  try { protocol = new URL(url).protocol; } catch { throw new Error("Invalid DEVHUB_STORAGE_URL"); }
  if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error("DEVHUB_STORAGE_URL must use Postgres");
  const pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000, idleTimeoutMillis: 1000, allowExitOnIdle: true });
  // Idle connection failures must not crash core or expose connection details.
  pool.on("error", () => console.error("[request-claims] idle Postgres connection failed"));
  const store = postgresRequestClaims(pool, workspaceId);
  configured = { url, workspaceId, pool, store };
  return store;
}

export async function closeRequestClaimStorage(): Promise<void> {
  const previous = configured;
  configured = undefined;
  await previous?.pool.end();
}
