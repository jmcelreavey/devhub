import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDirectory, planTaskDirs } from "./migrate.ts";
import { relinkMigratedRuns } from "./runs.ts";

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface RunRecord {
  runId?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function writeRuns(dir: string, taskId: string, runs: RunRecord[], extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${taskId}.json`), `${JSON.stringify({ version: 1, taskId, handoff: "", runs, ...extra }, null, 2)}\n`);
}

function readRuns(dir: string, taskId: string): { handoff: string; runs: RunRecord[] } & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, `${taskId}.json`), "utf8"));
}

function allRuns(dir: string): Map<string, RunRecord> {
  const out = new Map<string, RunRecord>();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith("_index")) continue;
    for (const run of readRuns(dir, name.replace(/\.json$/, "")).runs) {
      // The same run can sit in two files; the newest copy is the record.
      const previous = out.get(String(run.runId));
      if (!previous || String(run.updatedAt) > String(previous.updatedAt)) out.set(String(run.runId), run);
    }
  }
  return out;
}

function dirBytes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) out[name] = fs.readFileSync(path.join(dir, name), "utf8");
  return out;
}

const chains = [{ id: "keep", legacyIds: ["keep", "old1", "old2"] }];

describe("relinkMigratedRuns", () => {
  it("folds every legacy run file into the survivor and loses no run", () => {
    const dir = tmp("runs-fold-");
    writeRuns(dir, "old1", [{ runId: "r1", updatedAt: "1", status: "failed" }], { handoff: "first" });
    writeRuns(dir, "old2", [{ runId: "r2", updatedAt: "2", status: "done", prUrl: "https://example.test/1" }]);
    writeRuns(dir, "keep", [{ runId: "r3", updatedAt: "3" }]);
    fs.writeFileSync(path.join(dir, "_index.json"), JSON.stringify({ version: 1, byRunId: { r1: "old1", r2: "old2", r3: "keep" } }));
    const before = allRuns(dir);

    const result = relinkMigratedRuns(dir, chains);

    expect(result.merged).toEqual(["old1.json", "old2.json"]);
    expect(fs.existsSync(path.join(dir, "old1.json"))).toBe(false);
    expect(allRuns(dir)).toEqual(before);
    expect(readRuns(dir, "keep").handoff).toBe("first");
    const index = JSON.parse(fs.readFileSync(path.join(dir, "_index.json"), "utf8")) as { byRunId: Record<string, string> };
    expect(index.byRunId).toEqual({ r1: "keep", r2: "keep", r3: "keep" });
  });

  it("keeps runs that have no runId and unknown top-level keys", () => {
    const dir = tmp("runs-anon-");
    writeRuns(dir, "old1", [{ status: "mystery", note: "no id" }, { runId: "r1", updatedAt: "1" }], { futureField: { a: 1 } });
    writeRuns(dir, "keep", [{ status: "mystery", note: "no id" }, { status: "other" }]);
    relinkMigratedRuns(dir, chains);
    const merged = readRuns(dir, "keep");
    expect(merged.runs).toHaveLength(3);
    expect(merged.runs.filter((run) => !run.runId)).toHaveLength(2);
    expect(merged.futureField).toEqual({ a: 1 });
  });

  it("keeps the newer copy of a run that two files both hold", () => {
    const dir = tmp("runs-dup-");
    writeRuns(dir, "old1", [{ runId: "r1", updatedAt: "2026-09-01T10:00:00.000Z", status: "running" }]);
    writeRuns(dir, "keep", [{ runId: "r1", updatedAt: "2026-09-01T12:00:00.000Z", status: "done" }]);
    relinkMigratedRuns(dir, chains);
    expect(readRuns(dir, "keep").runs).toEqual([{ runId: "r1", updatedAt: "2026-09-01T12:00:00.000Z", status: "done" }]);
  });

  it("never deletes or overwrites a file it cannot parse", () => {
    const dir = tmp("runs-bad-");
    writeRuns(dir, "old1", [{ runId: "r1", updatedAt: "1" }]);
    fs.writeFileSync(path.join(dir, "old2.json"), "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n");
    const result = relinkMigratedRuns(dir, chains);
    expect(result.unreadable).toEqual(["old2.json"]);
    expect(fs.readFileSync(path.join(dir, "old2.json"), "utf8")).toContain("<<<<<<<");
    expect(readRuns(dir, "keep").runs.map((run) => run.runId)).toEqual(["r1"]);

    const bad = tmp("runs-bad-survivor-");
    writeRuns(bad, "old1", [{ runId: "r1", updatedAt: "1" }]);
    fs.writeFileSync(path.join(bad, "keep.json"), "not json");
    const second = relinkMigratedRuns(bad, chains);
    expect(second.unreadable).toEqual(["keep.json"]);
    expect(fs.readFileSync(path.join(bad, "keep.json"), "utf8")).toBe("not json");
    expect(fs.existsSync(path.join(bad, "old1.json"))).toBe(true);
  });

  it("repoints the index even when the legacy file is gone, and folds _index.local.json in", () => {
    const dir = tmp("runs-index-");
    writeRuns(dir, "keep", [{ runId: "r1", updatedAt: "1" }]);
    fs.writeFileSync(path.join(dir, "_index.local.json"), JSON.stringify({ version: 1, byRunId: { r1: "old1", r9: "old2" } }));
    relinkMigratedRuns(dir, chains);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "_index.json"), "utf8")) as { byRunId: Record<string, string> };
    expect(index.byRunId).toEqual({ r1: "keep", r9: "keep" });
    expect(fs.existsSync(path.join(dir, "_index.local.json"))).toBe(false);
  });

  it("is idempotent and independent of input order", () => {
    const seed = (dir: string) => {
      writeRuns(dir, "old1", [{ runId: "r1", updatedAt: "1" }], { handoff: "a" });
      writeRuns(dir, "old2", [{ runId: "r2", updatedAt: "2" }], { handoff: "b" });
      writeRuns(dir, "keep", [{ runId: "r3", updatedAt: "3" }], { handoff: "c" });
      fs.writeFileSync(path.join(dir, "_index.json"), JSON.stringify({ version: 1, byRunId: { r2: "old2", r1: "old1" } }));
    };
    const left = tmp("runs-left-");
    const right = tmp("runs-right-");
    seed(left);
    seed(right);
    relinkMigratedRuns(left, chains);
    const once = dirBytes(left);
    expect(relinkMigratedRuns(left, chains)).toEqual({ merged: [], unreadable: [], reindexed: 0 });
    expect(dirBytes(left)).toEqual(once);
    relinkMigratedRuns(right, [{ id: "keep", legacyIds: ["old2", "keep", "old1"] }]);
    expect(dirBytes(right)).toEqual(once);
  });
});

// Opt-in. DEVHUB_TASKS_REAL_DATA points at a directory with a/tasks, a/task-agent-runs, stale/tasks and stale/task-agent-runs.
const realRoot = process.env.DEVHUB_TASKS_REAL_DATA ?? "";
const runsA = path.join(realRoot, "a/task-agent-runs");
const runsStale = path.join(realRoot, "stale/task-agent-runs");
const haveRealData = Boolean(process.env.DEVHUB_TASKS_REAL_DATA) && [runsA, runsStale, path.join(realRoot, "a/tasks"), path.join(realRoot, "stale/tasks")].every((dir) => fs.existsSync(dir));

function copyRuns(src: string, prefix: string): string {
  const dest = tmp(prefix);
  fs.cpSync(src, dest, { recursive: true });
  for (const name of fs.readdirSync(dest)) fs.chmodSync(path.join(dest, name), 0o644);
  fs.chmodSync(dest, 0o755);
  return dest;
}

describe.skipIf(!haveRealData)("real run history", () => {
  it.each([
    ["machine A", [runsA], ["a/tasks"]],
    // The stale copy only carries its own run files plus a local index, so the real merge is the union.
    ["machine A + stale copy", [runsA, runsStale], ["a/tasks", "stale/tasks"]],
  ])("keeps every run record from the %s run history", (_name, sources, taskDirs) => {
    const dir = tmp("runs-real-");
    for (const source of sources as string[]) {
      fs.cpSync(source, dir, { recursive: true });
      for (const name of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, name), 0o644);
    }
    const before = allRuns(dir);
    const planned = planTaskDirs((taskDirs as string[]).map((rel) => path.join(realRoot, rel)));
    const link = planned.items.map((task) => ({ id: task.id, legacyIds: task.legacyIds }));

    const result = relinkMigratedRuns(dir, link);

    expect(result.unreadable).toEqual([]);
    const after = allRuns(dir);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [runId, run] of before) expect(after.get(runId), runId).toEqual(run);
    // No file is left under an id that was absorbed into another item.
    const absorbed = new Set(link.flatMap((item) => (item.legacyIds ?? []).filter((id) => id !== item.id)));
    for (const name of fs.readdirSync(dir)) expect(absorbed.has(name.replace(/\.json$/, "")), name).toBe(false);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "_index.json"), "utf8")) as { byRunId: Record<string, string> };
    expect(Object.keys(index.byRunId).sort()).toEqual([...before.keys()].sort());
    for (const taskId of Object.values(index.byRunId)) expect(fs.existsSync(path.join(dir, `${taskId}.json`)), taskId).toBe(true);
    expect(fs.existsSync(path.join(dir, "_index.local.json"))).toBe(false);

    const bytes = dirBytes(dir);
    relinkMigratedRuns(dir, link);
    expect(dirBytes(dir)).toEqual(bytes);
  });

  it("gives the same bytes on two machines and a real migrateDirectory run", async () => {
    const tasksA = tmp("runs-real-tasks-a-");
    const tasksB = tmp("runs-real-tasks-b-");
    for (const dir of [tasksA, tasksB]) {
      fs.cpSync(path.join(realRoot, "a/tasks"), dir, { recursive: true });
      const walk = (folder: string): void => {
        fs.chmodSync(folder, 0o755);
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const full = path.join(folder, entry.name);
          if (entry.isDirectory()) walk(full);
          else fs.chmodSync(full, 0o644);
        }
      };
      walk(dir);
    }
    const runsA = copyRuns(runsA, "runs-real-a-");
    const runsB = copyRuns(runsA, "runs-real-b-");
    const before = allRuns(runsA);
    const reportA = await migrateDirectory(tasksA, { runsDir: runsA });
    await migrateDirectory(tasksB, { runsDir: runsB });
    expect(reportA.dropped).toBe(0);
    expect(dirBytes(runsA)).toEqual(dirBytes(runsB));
    expect(allRuns(runsA)).toEqual(before);
  });
});
