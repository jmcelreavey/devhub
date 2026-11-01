/** Read-only task-store comparison; all benchmark databases/copies live in a fresh temporary folder. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { readItems, invalidateTaskCache } from "../../domains/tasks/store.ts";
import { sqliteAdapter } from "../../lib/db/sqlite/adapter.ts";
import type { Task } from "../../../../../packages/shared/tasks/types.ts";

const source = path.resolve(process.argv[2] ?? "../tasks/work");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-storage-bench-"));
const samples = 31;
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(3) };
}
async function measure(work: () => unknown | Promise<unknown>, count = samples) {
  const timings: number[] = [];
  for (let i = 0; i < count; i++) {
    const started = performance.now();
    await work();
    timings.push(performance.now() - started);
  }
  return stats(timings);
}
async function scenario(items: Task[], label: string) {
  const root = path.join(temporary, label);
  fs.mkdirSync(path.join(root, "items"), { recursive: true });
  for (const item of items) fs.writeFileSync(path.join(root, "items", item.id + ".json"), JSON.stringify(item));
  const file = path.join(root, "tasks.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, done INTEGER, rank TEXT, body TEXT); CREATE INDEX task_open_rank ON tasks(done,rank,id)");
  const insert = db.prepare("INSERT INTO tasks VALUES(?,?,?,?)");
  db.exec("BEGIN");
  for (const item of items) insert.run(item.id, Number(item.done), item.rank, JSON.stringify(item));
  db.exec("COMMIT");
  const sql = "SELECT body FROM tasks WHERE done=0 ORDER BY rank,id LIMIT 200";
  const expected = items.filter(item => !item.done).sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id)).slice(0, 200).length;
  const fileRead = () => {
    const rows = readItems(root).filter(item => !item.done).sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id)).slice(0, 200);
    if (rows.length !== expected) throw new Error("File result mismatch");
  };
  const query = db.prepare(sql);
  const sqliteRead = () => {
    const rows = query.all().map(row => JSON.parse(String(row.body)));
    if (rows.length !== expected) throw new Error("SQLite result mismatch");
  };
  const target = { id: "benchmark", engine: "sqlite" as const, accessMode: "read" as const, dangerous: false, sqlite: { file, readOnly: true } };
  const options = { timeoutMs: 5_000, rowLimit: 200, readOnly: true };
  const opened = performance.now();
  const client = await sqliteAdapter.open(target);
  const workerStartupMs = performance.now() - opened;
  try {
    return {
      label, items: items.length, returned: expected, samples,
      filesColdProcessCache: await measure(() => { invalidateTaskCache(root); fileRead(); }),
      filesWarmWithFreshnessCheck: await measure(fileRead),
      sqliteInProcessLowerBound: await measure(sqliteRead),
      sqliteWorkerWarm: await measure(async () => {
        const result = await sqliteAdapter.run(client, sql, options);
        if (result.rows.map(row => JSON.parse(String(row[0]))).length !== expected) throw new Error("Worker result mismatch");
      }),
      workerStartupMs: +workerStartupMs.toFixed(3),
      queryPlan: db.prepare("EXPLAIN QUERY PLAN " + sql).all().map(row => row.detail),
      databaseBytes: fs.statSync(file).size,
    };
  } finally { await sqliteAdapter.close(client); db.close(); }
}
async function main() {
  const items = readItems(source);
  if (!items.length) throw new Error("Pass a task profile containing items.");
  const scaled = Array.from({ length: 2500 }, (_, i) => ({ ...items[i % items.length], id: "bench-" + i }));
  console.log(JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    architecture: process.arch, systemMemoryGiB: os.totalmem() / 2 ** 30,
    method: "31 repeated local reads; OS caches warm; cold means cleared JS cache only. Full task JSON returned. SQLite worker startup is separate. Temporary copies; no production writes or content in output.",
    results: [await scenario(items, "current-profile"), await scenario(scaled, "scaled-2500")],
  }, null, 2));
}
main().finally(() => fs.rmSync(temporary, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
