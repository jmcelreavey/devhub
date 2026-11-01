import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeRequestClaimStorage, postgresRequestClaims, requestClaimStorage, sqliteRequestClaims } from "./request-claims";
import { closeSqliteDatabase, sqliteDatabasePath } from "./sqlite";

const postgresUrl = process.env.DEVHUB_STORAGE_URL;
const hash = createHash("sha256").update("same submission").digest("hex");
const first = "run-abc123-00000001";
const second = "run-abc123-00000002";

describe.each(["sqlite", "postgres"])("request claim contract (%s)", (backend) => {
  it.skipIf(backend === "postgres" && !postgresUrl)("persists one winner across clients and preserves it on retry", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "r8-cloud-claims-"));
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_STATE_HOME", root);
    vi.stubEnv("DEVHUB_STATE_PROFILE", "");
    vi.stubEnv("DEVHUB_DESKTOP", "");
    const workspaceId = randomUUID();
    vi.stubEnv("DEVHUB_WORKSPACE_ID", workspaceId);
    vi.stubEnv("DEVHUB_STORAGE_URL", backend === "postgres" ? postgresUrl : undefined);
    const pool = backend === "postgres" ? new Pool({ connectionString: postgresUrl }) : undefined;
    const create = () => pool ? postgresRequestClaims(pool, workspaceId) : sqliteRequestClaims(root);
    try {
      const store = requestClaimStorage(root);
      const other = create();
      expect(await Promise.all([store.read(hash), other.read(hash)])).toEqual([null, null]);
      const winners = await Promise.all([store.claim(hash, first), other.claim(hash, second)]);
      expect(new Set(winners).size).toBe(1);
      expect(await create().read(hash)).toBe(winners[0]);
      expect(await create().claim(hash, second)).toBe(winners[0]);
      if (pool) {
        const isolated = postgresRequestClaims(pool, `${workspaceId}-other`);
        expect(await isolated.read(hash)).toBeNull();
        await isolated.release(hash, winners[0]);
      }
      const loser = winners[0] === first ? second : first;
      await other.release(hash, loser);
      expect(await store.read(hash)).toBe(winners[0]);
      await other.release(hash, winners[0]);
      expect(await store.read(hash)).toBeNull();
      expect(await store.claim(hash, loser)).toBe(loser);
    } finally {
      await closeRequestClaimStorage();
      if (pool) {
        await pool.query("DELETE FROM devhub_request_claims WHERE workspace_id = $1", [workspaceId]);
        await pool.end();
      }
      closeSqliteDatabase(sqliteDatabasePath());
      vi.unstubAllEnvs();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("storage opt-in", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("rejects unsupported URLs without including credentials in the error", () => {
    vi.stubEnv("DEVHUB_STORAGE_URL", "https://example.invalid");
    expect(() => requestClaimStorage("unused")).toThrow("must use Postgres");
  });
});
