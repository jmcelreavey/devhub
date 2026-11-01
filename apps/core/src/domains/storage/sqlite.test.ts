import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "./sqlite.ts";

const directories: string[] = [];
const modulePath = path.resolve(__dirname, "sqlite.ts");

function temporaryDatabase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sqlite-test-"));
  directories.push(dir);
  return path.join(dir, "devhub.db");
}

function runChild(script: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", script, filename], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`)));
  });
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    closeSqliteDatabase(path.join(dir, "devhub.db"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SQLite foundation", () => {
  it("uses the same state scopes as run history", () => {
    expect(sqliteDatabasePath({ HOME: "/fixture" })).toBe(path.join("/fixture", ".local", "state", "devhub", "devhub.db"));
    expect(sqliteDatabasePath({ HOME: "/fixture", DEVHUB_DESKTOP: "1", DEVHUB_STATE_PROFILE: "0123456789abcdef" })).toBe(path.join("/fixture", ".local", "state", "devhub", "profiles", "0123456789abcdef", "devhub.db"));
    expect(sqliteDatabasePath({ HOME: "/fixture", DEVHUB_DESKTOP: "1", DEVHUB_APP_DATA: "/other" })).toBe(path.join(path.resolve("/other"), "logs", "devhub.db"));
  });

  it("migrates, reuses the connection, and binds arbitrary values", () => {
    const filename = temporaryDatabase();
    const db = openSqliteDatabase(filename);
    expect(openSqliteDatabase(filename)).toBe(db);
    if (process.platform !== "win32") expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    expect(db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA synchronous").get()?.synchronous).toBe(1);
    expect(db.prepare("PRAGMA busy_timeout").get()?.timeout).toBe(2000);
    expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    db.exec("CREATE TABLE values_test (value TEXT)");
    const value = "'); DROP TABLE values_test; --";
    db.prepare("INSERT INTO values_test VALUES (?)").run(value);
    expect(db.prepare("SELECT value FROM values_test WHERE value = ?").get(value)?.value).toBe(value);
  });

  it("shares its connection across module reloads", async () => {
    const filename = temporaryDatabase();
    const db = openSqliteDatabase(filename);
    vi.resetModules();
    const reloaded = await import("./sqlite.ts");
    expect(reloaded.openSqliteDatabase(filename)).toBe(db);
  });

  it("upgrades a version-zero database without discarding existing data", () => {
    const filename = temporaryDatabase();
    const result = spawnSync(process.execPath, ["-e", `const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); db.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('ok')"); db.close();`, filename]);
    expect(result.status).toBe(0);
    const db = openSqliteDatabase(filename);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    expect(db.prepare("SELECT value FROM preserved").get()?.value).toBe("ok");
  });

  it("reopens a migrated database and refuses a newer schema", () => {
    const filename = temporaryDatabase();
    const db = openSqliteDatabase(filename);
    const script = `const { openSqliteDatabase } = require(${JSON.stringify(modulePath)}); const db = openSqliteDatabase(process.argv[1]); if (db.prepare("PRAGMA user_version").get().user_version !== 3) process.exit(1);`;
    const reopened = spawnSync(process.execPath, ["--import", "tsx", "-e", script, filename], { encoding: "utf8" });
    expect(reopened.status).toBe(0);
    expect(reopened.stderr).not.toContain("SQLite is an experimental feature");
    db.exec("PRAGMA user_version=4");
    const newer = spawnSync(process.execPath, ["--import", "tsx", "-e", script, filename], { encoding: "utf8" });
    expect(newer.status).not.toBe(0);
    expect(newer.stderr).toContain("newer than supported");
  });

  it("serialises writers across processes", async () => {
    const filename = temporaryDatabase();
    const db = openSqliteDatabase(filename);
    db.exec("CREATE TABLE writes (value TEXT)");
    const script = `const { openSqliteDatabase } = require(${JSON.stringify(modulePath)}); const db = openSqliteDatabase(process.argv[1]); const insert = db.prepare("INSERT INTO writes VALUES (?)"); for (let index = 0; index < 100; index++) insert.run(String(index));`;
    await Promise.all([runChild(script, filename), runChild(script, filename)]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM writes").get()?.count).toBe(200);
  });
});
