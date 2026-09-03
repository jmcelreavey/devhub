import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqliteAdapter } from "./adapter";
import type { DbClient } from "../adapter";
import type { ResolvedDbConnection } from "../types";

/**
 * These run against a real database file rather than a mock.
 *
 * The worker body is a source string (see `worker-source.ts` for why), so the
 * compiler does not check it. That makes these tests the only thing standing
 * between a typo in the worker and a broken engine, so they exercise the actual
 * round trip.
 */

let dir: string;
let file: string;
let open: DbClient[] = [];

const target = (readOnly: boolean): ResolvedDbConnection => ({
  id: "local:test",
  engine: "sqlite",
  accessMode: readOnly ? "read" : "write",
  dangerous: false,
  sqlite: { file, readOnly },
});

const run = (client: DbClient, statement: string, overrides = {}) =>
  sqliteAdapter.run(client, statement, {
    timeoutMs: 5_000,
    rowLimit: 100,
    readOnly: false,
    ...overrides,
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sqlite-"));
  file = path.join(dir, "test.db");

  const seed = new DatabaseSync(file);
  seed.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB)");
  seed.exec("INSERT INTO users (name, score) VALUES ('ada', 9.5), ('grace', 9.9), ('alan', 9.7)");
  seed.close();
});

afterEach(async () => {
  await Promise.all(open.map((c) => sqliteAdapter.close(c)));
  open = [];
  fs.rmSync(dir, { recursive: true, force: true });
});

async function connect(readOnly = false): Promise<DbClient> {
  const client = await sqliteAdapter.open(target(readOnly));
  open.push(client);
  return client;
}

describe("sqlite adapter", () => {
  it("runs a query and returns columns and rows", async () => {
    const client = await connect();
    const result = await run(client, "SELECT id, name FROM users ORDER BY id");
    expect(result.columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "ada"],
      [2, "grace"],
      [3, "alan"],
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports the column's declared type", async () => {
    const client = await connect();
    const result = await run(client, "SELECT id, name, score FROM users");
    expect(result.columns.map((c) => c.dataType)).toEqual(["INTEGER", "TEXT", "REAL"]);
  });

  it("truncates at the row limit and says so", async () => {
    const client = await connect();
    const result = await run(client, "SELECT * FROM users", { rowLimit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("reports rows affected for a statement that returns nothing", async () => {
    const client = await connect();
    const result = await run(client, "UPDATE users SET score = 10 WHERE name = 'ada'");
    expect(result.rowsAffected).toBe(1);
  });

  it("ping succeeds on a healthy connection", async () => {
    const client = await connect();
    await expect(sqliteAdapter.ping(client)).resolves.toBeUndefined();
  });

  /**
   * The guarantee, not the classifier. Opening read-only means SQLite itself
   * refuses the write — this is what holds when the parser is wrong.
   */
  it("refuses writes on a read-only handle", async () => {
    const client = await connect(true);
    await expect(run(client, "UPDATE users SET score = 0")).rejects.toThrow(/readonly|read-only/i);
  });

  it("still allows reads on a read-only handle", async () => {
    const client = await connect(true);
    const result = await run(client, "SELECT count(*) AS n FROM users");
    expect(result.rows).toEqual([[3]]);
  });

  it("surfaces a SQL error as a readable message", async () => {
    const client = await connect();
    await expect(run(client, "SELECT * FROM nope")).rejects.toThrow(/no such table/i);
  });

  it("keeps working after a failed statement", async () => {
    const client = await connect();
    await expect(run(client, "SELECT * FROM nope")).rejects.toThrow();
    const result = await run(client, "SELECT count(*) AS n FROM users");
    expect(result.rows).toEqual([[3]]);
  });

  /** BigInt would otherwise make JSON.stringify throw on the whole result. */
  it("renders integers beyond Number.MAX_SAFE_INTEGER as strings", async () => {
    const client = await connect();
    await run(client, "CREATE TABLE big (n INTEGER)");
    await run(client, "INSERT INTO big (n) VALUES (9223372036854775807)");
    const result = await run(client, "SELECT n FROM big");
    expect(result.rows[0][0]).toBe("9223372036854775807");
  });

  it("renders blobs as hex", async () => {
    const client = await connect();
    await run(client, "UPDATE users SET data = x'01ff' WHERE id = 1");
    const result = await run(client, "SELECT data FROM users WHERE id = 1");
    expect(result.rows[0][0]).toBe("\\x01ff");
  });

  /**
   * Reported by `open()`, not by the first query — the failure belongs to the
   * thing the user just clicked, not to whatever they typed next.
   */
  it("reports a missing file when opening, with the path in the message", async () => {
    const missing = path.join(dir, "absent.db");
    await expect(
      sqliteAdapter.open({
        id: "local:missing",
        engine: "sqlite",
        accessMode: "read",
        dangerous: false,
        sqlite: { file: missing, readOnly: true },
      }),
    ).rejects.toThrow(/absent\.db/);
  });

  /**
   * The reason the worker exists. SQLite cannot be interrupted, so the only
   * bound on a runaway statement is killing the thread.
   */
  it("terminates the worker when a statement exceeds its timeout", async () => {
    const client = await connect();
    // A recursive CTE that never finishes, and cannot be interrupted.
    const forever = `WITH RECURSIVE spin(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM spin) SELECT count(*) FROM spin`;
    await expect(run(client, forever, { timeoutMs: 700 })).rejects.toThrow(/exceeded its/);
  }, 15_000);

  it("serialises overlapping statements", async () => {
    const client = await connect();
    const results = await Promise.all([
      run(client, "SELECT 1 AS a"),
      run(client, "SELECT 2 AS a"),
      run(client, "SELECT 3 AS a"),
    ]);
    expect(results.map((r) => r.rows[0][0])).toEqual([1, 2, 3]);
  });

  it("cancel reports false when nothing is running", async () => {
    const client = await connect();
    expect(await sqliteAdapter.cancel(client)).toBe(false);
  });
});
