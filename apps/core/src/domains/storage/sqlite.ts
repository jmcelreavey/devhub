import fs from "node:fs";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync as Database } from "node:sqlite";
import { defaultAppDataDir, profileStateDir, stateProfileId } from "../../../../../packages/shared/storage/profile-state.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function sqliteDatabasePath(env: Env = process.env): string {
  const home = env.HOME?.trim() || os.homedir();
  const appData = env.DEVHUB_APP_DATA?.trim();
  if (!stateProfileId(env) && env.DEVHUB_DESKTOP === "1" && appData && path.resolve(appData) !== defaultAppDataDir(home, env)) {
    return path.join(path.resolve(appData), "logs", "devhub.db");
  }
  return path.join(profileStateDir(env, home), "devhub.db");
}

function loadSqlite(): typeof import("node:sqlite") {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (typeof warning === "string" && warning === "SQLite is an experimental feature and might change at any time" && args[0] === "ExperimentalWarning") return;
    return Reflect.apply(emitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try {
    const nodeRequire = Reflect.get(nodeModule, "createRequire") as typeof nodeModule.createRequire;
    return nodeRequire(path.join(process.cwd(), "package.json"))("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

/** Open an existing run database without creating or migrating it. */
export function openReadOnlySqliteDatabase(filename = sqliteDatabasePath()): Database | null {
  try {
    if (!fs.lstatSync(filename).isFile()) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return new (loadSqlite().DatabaseSync)(filename, { readOnly: true });
}

const migrations = ["", `
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY, directory TEXT NOT NULL, root TEXT NOT NULL, profile TEXT,
    created_at INTEGER, status TEXT, spec_json TEXT, status_json TEXT, source_events TEXT
  );
  CREATE INDEX agent_runs_root_created ON agent_runs(root, created_at DESC);
  CREATE INDEX agent_runs_status ON agent_runs(status);
  CREATE TABLE agent_run_events (
    run_id TEXT NOT NULL REFERENCES agent_runs(id), seq INTEGER NOT NULL,
    json TEXT NOT NULL, imported INTEGER NOT NULL, PRIMARY KEY (run_id, seq)
  );
  CREATE TABLE agent_request_claims (hash TEXT PRIMARY KEY, claim_json TEXT NOT NULL);
`, `
  ALTER TABLE agent_runs ADD COLUMN source_spec TEXT;
  ALTER TABLE agent_runs ADD COLUMN source_status TEXT;
  UPDATE agent_runs SET source_spec = spec_json, source_status = status_json;
`];
const sqliteProcess = process as NodeJS.Process & { __devhubSqliteConnections?: Map<string, Database> };
const connections = sqliteProcess.__devhubSqliteConnections ??= new Map<string, Database>();

export function closeSqliteDatabase(filename: string): void {
  const resolved = path.resolve(filename);
  const db = connections.get(resolved);
  if (!db) return;
  db.close();
  connections.delete(resolved);
}

export function openSqliteDatabase(filename = sqliteDatabasePath()): Database {
  const resolved = path.resolve(filename);
  const cached = connections.get(resolved);
  if (cached) return cached;
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(resolved, "a", 0o600));
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(resolved);
  try {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
    db.exec("BEGIN IMMEDIATE");
    try {
      const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > migrations.length) throw new Error(`SQLite schema version ${version} is newer than supported version ${migrations.length}`);
      for (let index = version; index < migrations.length; index++) {
        if (migrations[index]) db.exec(migrations[index]);
        db.exec(`PRAGMA user_version=${index + 1}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    connections.set(resolved, db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
