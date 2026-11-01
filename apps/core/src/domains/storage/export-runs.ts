import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { openSqliteDatabase } from "./sqlite.ts";

interface RunRow {
  id: string;
  spec_json: string | null;
  status_json: string | null;
  source_spec: string | null;
  source_status: string | null;
  source_events: string | null;
}

interface ExportFile {
  relative: string;
  content: string;
  source: string | null;
}

function treeDigest(root: string): string {
  const digest = createHash("sha256");
  function walk(dir: string, relative: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      const file = path.join(dir, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("Run export refuses symbolic links in the destination.");
      digest.update(JSON.stringify([name, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]));
      if (stat.isDirectory()) walk(file, name);
      else if (stat.isFile()) digest.update(fs.readFileSync(file));
      else throw new Error("Run export refuses non-file entries in the destination.");
    }
  }
  walk(root, "");
  return digest.digest("hex");
}

function snapshot(): { files: ExportFile[]; runs: number; version: number } {
  const db = openSqliteDatabase();
  db.exec("BEGIN");
  try {
    const version = Number(db.prepare("PRAGMA data_version").get()?.data_version);
    const rows = db.prepare("SELECT id, spec_json, status_json, source_spec, source_status, source_events FROM agent_runs ORDER BY id").all() as unknown as RunRow[];
    const events = db.prepare("SELECT json FROM agent_run_events WHERE run_id = ? AND imported = 0 ORDER BY seq");
    const files: ExportFile[] = [];
    for (const row of rows) {
      if (!/^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/.test(row.id)) throw new Error("Invalid run ID in SQLite.");
      if (row.spec_json !== null) files.push({ relative: path.join(row.id, "spec.json"), content: row.spec_json, source: row.source_spec });
      if (row.status_json !== null) files.push({ relative: path.join(row.id, "status.json"), content: row.status_json, source: row.source_status });
      const appended = events.all(row.id).map((event) => String(event.json));
      if (row.source_events !== null || appended.length) {
        const original = row.source_events ?? "";
        const separator = appended.length && original && !original.endsWith("\n") ? "\n" : "";
        files.push({ relative: path.join(row.id, "events.jsonl"), content: original + separator + appended.map((event) => `${event}\n`).join(""), source: row.source_events });
      }
    }
    for (const claim of db.prepare("SELECT hash, claim_json FROM agent_request_claims ORDER BY hash").all()) {
      const hash = String(claim.hash);
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid request claim in SQLite.");
      const content = String(claim.claim_json);
      files.push({ relative: path.join(".requests", `${hash}.json`), content, source: content });
    }
    db.exec("COMMIT");
    return { files, runs: rows.length, version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function exportRuns(destination: string): { runs: number; files: number } {
  const target = path.resolve(destination);
  const parent = path.dirname(target);
  if (target === parent) throw new Error("Choose a run directory, not a filesystem root.");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  let exists = false;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The export destination must be a real directory.");
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists && fs.existsSync(path.join(target, ".admission"))) throw new Error("An agent request is starting; retry the export when idle.");
  const captured = snapshot();
  const staging = fs.mkdtempSync(path.join(parent, ".devhub-runs-export-"));
  const backup = path.join(parent, `.devhub-runs-backup-${randomBytes(12).toString("hex")}`);
  let moved = false;
  let installed = false;
  try {
    const originalDigest = exists ? treeDigest(target) : null;
    if (exists) fs.cpSync(target, staging, { recursive: true, preserveTimestamps: true });
    treeDigest(staging);
    for (const file of captured.files) {
      const output = path.join(staging, file.relative);
      try {
        const stat = fs.lstatSync(output);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Run export refuses a non-file destination.");
        const current = fs.readFileSync(output, "utf8");
        if (current === file.content) continue;
        if (file.source === null || current !== file.source) throw new Error(`Run export refuses a newer or unverified file: ${file.relative}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      fs.writeFileSync(output, file.content, { mode: 0o600 });
    }
    const db = openSqliteDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (Number(db.prepare("PRAGMA data_version").get()?.data_version) !== captured.version) throw new Error("Agent runs changed during export; try again when idle.");
      if (exists) {
        fs.renameSync(target, backup);
        moved = true;
        if (treeDigest(backup) !== originalDigest) throw new Error("Run folders changed during export; no files were replaced.");
      } else if (fs.existsSync(target)) throw new Error("The export destination appeared during export.");
      fs.renameSync(staging, target);
      installed = true;
      db.exec("COMMIT");
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try { db.exec("ROLLBACK"); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      try {
        if (installed) { fs.renameSync(target, staging); installed = false; }
        if (moved) { fs.renameSync(backup, target); moved = false; }
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "Run export failed and rollback needs attention.");
      throw error;
    }
    if (moved) { fs.rmSync(backup, { recursive: true, force: true }); moved = false; }
    return { runs: captured.runs, files: captured.files.length };
  } finally {
    if (!installed) fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (["export-runs.ts", "storage-export-runs.cjs"].includes(path.basename(process.argv[1] ?? ""))) {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    process.stderr.write("Usage: tsx apps/core/src/domains/storage/export-runs.ts <run-directory>\n");
    process.exitCode = 2;
  } else {
    try {
      const result = exportRuns(destination);
      process.stdout.write(`Exported ${result.runs} runs and ${result.files} files.\n`);
    } catch (error) {
      process.stderr.write(`Run export failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
