import fs from "node:fs";
import path from "node:path";
import { openReadOnlySqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "./sqlite";
import type { AgentRunSpec, AgentRunStatus, RecordedAgentRunEvent, RunEventPage } from "../../../../../packages/shared/agent-runs/contracts.ts";

const importedRoots = new Set<string>();
const runIdPattern = /^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/;

/** SQLite is the default run store. `DEVHUB_STORAGE_SQLITE=0` rolls back to run folders (export first with storage-export-runs). */
export function sqliteRunsEnabled(): boolean {
  return process.env.DEVHUB_STORAGE_SQLITE !== "0";
}

function readSource(file: string): string | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return null;
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function importDirectory(dir: string): void {
  const id = path.basename(dir);
  if (!runIdPattern.test(id)) return;
  try { if (!fs.lstatSync(dir).isDirectory()) return; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const db = openSqliteDatabase();
  const existing = db.prepare("SELECT directory, spec_json, status_json, source_spec, source_status FROM agent_runs WHERE id = ?").get(id);
  if (existing) {
    if (path.resolve(String(existing.directory)) !== path.resolve(dir)) return;
    // Earlier imports could skip files over 1 MiB while retaining the other
    // half of a run. Only fill fields that SQLite has never held or updated.
    if (existing.spec_json === null && existing.source_spec === null) {
      const raw = readSource(path.join(dir, "spec.json"));
      const spec = parseObject(raw) as unknown as AgentRunSpec | null;
      if (spec) db.prepare("UPDATE agent_runs SET spec_json = ?, source_spec = ?, profile = ?, created_at = ? WHERE id = ? AND spec_json IS NULL AND source_spec IS NULL").run(
        raw, raw, typeof spec.activity?.taskScope?.profile === "string" ? spec.activity.taskScope.profile : null,
        typeof spec.createdAt === "number" ? spec.createdAt : null, id,
      );
    }
    if (existing.status_json === null && existing.source_status === null) {
      const raw = readSource(path.join(dir, "status.json"));
      const status = parseObject(raw) as unknown as AgentRunStatus | null;
      if (status) db.prepare("UPDATE agent_runs SET status_json = ?, source_status = ?, status = ? WHERE id = ? AND status_json IS NULL AND source_status IS NULL").run(
        raw, raw, typeof status.state === "string" ? status.state : null, id,
      );
    }
    return;
  }
  const specRaw = readSource(path.join(dir, "spec.json"));
  const statusRaw = readSource(path.join(dir, "status.json"));
  const spec = parseObject(specRaw) as unknown as AgentRunSpec | null;
  const status = parseObject(statusRaw) as unknown as AgentRunStatus | null;
  if (!spec && !status) return;
  const eventsRaw = readSource(path.join(dir, "events.jsonl"));
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db.prepare("INSERT OR IGNORE INTO agent_runs (id, directory, root, profile, created_at, status, spec_json, status_json, source_events, source_spec, source_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, dir, path.dirname(dir), typeof spec?.activity?.taskScope?.profile === "string" ? spec.activity.taskScope.profile : null,
      typeof spec?.createdAt === "number" ? spec.createdAt : null, typeof status?.state === "string" ? status.state : null,
      specRaw, statusRaw, eventsRaw, specRaw, statusRaw,
    );
    if (inserted.changes && eventsRaw) {
      const insert = db.prepare("INSERT INTO agent_run_events (run_id, seq, json, imported) VALUES (?, ?, ?, 1)");
      let seq = 0;
      for (const line of eventsRaw.split("\n").slice(0, -1)) {
        if (!line) continue;
        try { JSON.parse(line); } catch { continue; }
        insert.run(id, seq++, line);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importClaim(root: string, hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) return;
  const db = openSqliteDatabase();
  if (db.prepare("SELECT 1 FROM agent_request_claims WHERE hash = ?").get(hash)) return;
  const file = path.join(root, ".requests", `${hash}.json`);
  let raw: string | null;
  try {
    const stat = fs.lstatSync(file);
    raw = !stat.isFile() || stat.size > 1024 * 1024 ? "{}" : fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    raw = null;
  }
  if (raw !== null) db.prepare("INSERT OR IGNORE INTO agent_request_claims (hash, claim_json) VALUES (?, ?)").run(hash, raw);
}

export function importRunRoot(root: string): void {
  const key = `${sqliteDatabasePath()}\0${path.resolve(root)}`;
  if (importedRoots.has(key)) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  for (const entry of entries) {
    if (entry.isDirectory() && runIdPattern.test(entry.name)) importDirectory(path.join(root, entry.name));
  }
  let claims: string[];
  try { claims = fs.readdirSync(path.join(root, ".requests")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    claims = [];
  }
  for (const claim of claims) if (claim.endsWith(".json")) importClaim(root, claim.slice(0, -5));
  importedRoots.add(key);
}

function findRun(dir: string): Record<string, unknown> | undefined {
  importRunRoot(path.dirname(dir));
  const db = openSqliteDatabase();
  let row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(path.basename(dir));
  if (!row) {
    importDirectory(dir);
    row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(path.basename(dir));
  }
  return row;
}

export function sqliteRunDirectories(root: string): string[] {
  importRunRoot(root);
  const db = openSqliteDatabase();
  let rows = db.prepare("SELECT id, directory FROM agent_runs WHERE root = ? ORDER BY created_at DESC").all(root);
  const known = new Set(rows.map((row) => String(row.id)));
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  for (const entry of entries) {
    if (entry.isDirectory() && runIdPattern.test(entry.name) && !known.has(entry.name)) importDirectory(path.join(root, entry.name));
  }
  rows = db.prepare("SELECT id, directory FROM agent_runs WHERE root = ? ORDER BY created_at DESC").all(root);
  return rows.map((row) => String(row.directory));
}

export function sqliteReadSpec(dir: string): AgentRunSpec | null {
  return parseObject(findRun(dir)?.spec_json as string | null | undefined) as unknown as AgentRunSpec | null;
}

export function sqliteReadStatus(dir: string): AgentRunStatus | null {
  return parseObject(findRun(dir)?.status_json as string | null | undefined) as unknown as AgentRunStatus | null;
}

/** Read a single existing run without importing folders or reconciling its status. */
export function sqlitePeekRun(dir: string): { spec: AgentRunSpec; status: AgentRunStatus; events: RecordedAgentRunEvent[]; incompleteEvents: boolean } | null {
  const db = openReadOnlySqliteDatabase();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT directory, spec_json, status_json FROM agent_runs WHERE id = ? AND length(spec_json) <= 4194304 AND length(status_json) <= 4194304").get(path.basename(dir));
    if (!row || path.resolve(String(row.directory)) !== path.resolve(dir)) return null;
    const spec = parseObject(row.spec_json as string | null | undefined) as unknown as AgentRunSpec | null;
    const status = parseObject(row.status_json as string | null | undefined) as unknown as AgentRunStatus | null;
    if (!spec || !status) return null;
    const rows = db.prepare("SELECT CASE WHEN length(json) <= 65536 THEN json ELSE NULL END AS json FROM agent_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 30").all(path.basename(dir));
    let incompleteEvents = false;
    const events = rows.reverse().flatMap((event) => {
      try {
        if (event.json === null) throw new Error("Oversized event");
        return [JSON.parse(String(event.json)) as RecordedAgentRunEvent];
      } catch { incompleteEvents = true; return []; }
    });
    return { spec, status, events, incompleteEvents };
  } finally {
    db.close();
  }
}

export function sqliteWriteSpec(dir: string, spec: AgentRunSpec): void {
  importRunRoot(path.dirname(dir));
  openSqliteDatabase().prepare("INSERT INTO agent_runs (id, directory, root, profile, created_at, spec_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET spec_json = excluded.spec_json, profile = excluded.profile, created_at = excluded.created_at").run(
    spec.id, dir, path.dirname(dir), spec.activity?.taskScope?.profile ?? null, spec.createdAt, JSON.stringify(spec, null, 2),
  );
}

export function sqliteWriteStatus(dir: string, status: AgentRunStatus): void {
  findRun(dir);
  const result = openSqliteDatabase().prepare("UPDATE agent_runs SET status_json = ?, status = ? WHERE id = ?").run(JSON.stringify(status, null, 2), status.state, path.basename(dir));
  if (!result.changes) throw new Error("Cannot update a missing agent run");
}

export function sqliteAppendEvent(dir: string, event: RecordedAgentRunEvent): void {
  findRun(dir);
  openSqliteDatabase().prepare("INSERT INTO agent_run_events (run_id, seq, json, imported) SELECT ?, COALESCE(MAX(seq) + 1, 0), ?, 0 FROM agent_run_events WHERE run_id = ?").run(path.basename(dir), JSON.stringify(event), path.basename(dir));
}

export function sqliteReadEvents(dir: string, since: number, limit: number): RunEventPage {
  if (!findRun(dir)) return { events: [], next: since, total: 0 };
  const db = openSqliteDatabase();
  const id = path.basename(dir);
  const total = Number(db.prepare("SELECT COUNT(*) AS count FROM agent_run_events WHERE run_id = ?").get(id)?.count ?? 0);
  const rows = db.prepare("SELECT json FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq LIMIT ?").all(id, Math.max(0, since), Math.max(0, limit));
  const events = rows.map((row) => JSON.parse(String(row.json)) as RecordedAgentRunEvent);
  return { events, next: since + events.length, total };
}

export function sqliteReadClaim(root: string, hash: string): string | null {
  importRunRoot(root);
  importClaim(root, hash);
  const row = openSqliteDatabase().prepare("SELECT claim_json FROM agent_request_claims WHERE hash = ?").get(hash);
  if (!row) return null;
  const claim = parseObject(String(row.claim_json));
  if (typeof claim?.runId !== "string") throw new Error("The prior request needs attention before it can be retried.");
  return claim.runId;
}

export function sqliteClaim(root: string, hash: string, runId: string): string {
  importRunRoot(root);
  importClaim(root, hash);
  openSqliteDatabase().prepare("INSERT OR IGNORE INTO agent_request_claims (hash, claim_json) VALUES (?, ?)").run(hash, JSON.stringify({ runId }));
  const claimed = sqliteReadClaim(root, hash);
  if (claimed === null) throw new Error("Agent request claim was not saved");
  return claimed;
}

export function sqliteReleaseClaim(root: string, hash: string, runId: string): void {
  importRunRoot(root);
  importClaim(root, hash);
  openSqliteDatabase().prepare("DELETE FROM agent_request_claims WHERE hash = ? AND json_extract(claim_json, '$.runId') = ?").run(hash, runId);
}
