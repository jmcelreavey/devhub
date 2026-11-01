import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "../exec-external";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "../../domains/storage/sqlite";
import { appendRunEvent, readRunEvents, readRunSpec, writeRunStatus } from "./run-files";
import { claimAgentRequest, readAgentRequest } from "./claims";
import { sqliteRunDirectories, sqliteRunsEnabled } from "../../domains/storage/runs";

describe("SQLite run storage default", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is on unless DEVHUB_STORAGE_SQLITE is 0", () => {
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", undefined);
    expect(sqliteRunsEnabled()).toBe(true);
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "");
    expect(sqliteRunsEnabled()).toBe(true);
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "1");
    expect(sqliteRunsEnabled()).toBe(true);
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    expect(sqliteRunsEnabled()).toBe(false);
  });
});

describe("SQLite run import", () => {
  let root: string;
  let runs: string;
  beforeEach(() => {
    vi.stubEnv("DEVHUB_STORAGE_URL", undefined);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sqlite-runs-"));
    runs = path.join(root, "runs");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_STATE_HOME", path.join(root, "state"));
    vi.stubEnv("DEVHUB_DESKTOP", "");
    vi.stubEnv("DEVHUB_STATE_PROFILE", "");
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", runs);
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "1");
  });
  afterEach(() => {
    closeSqliteDatabase(sqliteDatabasePath());
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture(id: string): string {
    const dir = path.join(runs, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ id, provider: "fixture", createdAt: 1 }));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ state: "succeeded", updatedAt: 1, eventCount: 2 }));
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ type: "text", text: "one", seq: 0, ts: 1 })}\nbroken\n${JSON.stringify({ type: "text", text: "two", seq: 1, ts: 2 })}\n`);
    return dir;
  }

  it("imports once, preserves source bytes, and pages past a corrupt line", () => {
    const dir = fixture("run-abc123-00000001");
    const source = ["spec.json", "status.json", "events.jsonl"].map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
    expect(readRunSpec(dir)?.id).toBe(path.basename(dir));
    expect(readRunSpec(dir)?.id).toBe(path.basename(dir));
    const first = readRunEvents(dir, 0, 1);
    const second = readRunEvents(dir, first.next, 1);
    expect([first.events[0].seq, second.events[0].seq]).toEqual([0, 1]);
    expect(second).toMatchObject({ next: 2, total: 2 });
    appendRunEvent(dir, { type: "text", text: "three", seq: 2, ts: 3 });
    expect(readRunEvents(dir, second.next, 2)).toMatchObject({ next: 3, total: 3 });
    writeRunStatus(dir, { state: "failed", updatedAt: 2, eventCount: 3 });
    expect(["spec.json", "status.json", "events.jsonl"].map((name) => fs.readFileSync(path.join(dir, name), "utf8"))).toEqual(source);
    expect(openSqliteDatabase().prepare("SELECT COUNT(*) AS count FROM agent_runs").get()?.count).toBe(1);
  });

  it("imports an unknown run that appears after the initial scan", () => {
    expect(sqliteRunDirectories(runs)).toEqual([]);
    const dir = fixture("run-abc123-00000002");
    expect(readRunSpec(dir)?.id).toBe(path.basename(dir));
    expect(sqliteRunDirectories(runs)).toContain(dir);
  });

  it("imports a large file-backed spec without losing the run", () => {
    const dir = fixture("run-abc123-00000003");
    const spec = JSON.stringify({ id: path.basename(dir), createdAt: 1, prompt: "x".repeat(1024 * 1024) });
    fs.writeFileSync(path.join(dir, "spec.json"), spec);
    expect(readRunSpec(dir)?.prompt).toHaveLength(1024 * 1024);
    expect(fs.readFileSync(path.join(dir, "spec.json"), "utf8")).toBe(spec);
  });

  it("repairs a spec skipped by an earlier import without replacing a newer status", () => {
    const dir = fixture("run-abc123-00000005");
    const spec = JSON.stringify({ id: path.basename(dir), createdAt: 1, prompt: "x".repeat(1024 * 1024) });
    fs.writeFileSync(path.join(dir, "spec.json"), spec);
    const newerStatus = JSON.stringify({ state: "failed", updatedAt: 2, eventCount: 2 });
    openSqliteDatabase().prepare("INSERT INTO agent_runs (id, directory, root, status, status_json, source_status) VALUES (?, ?, ?, ?, ?, ?)").run(
      path.basename(dir), dir, runs, "failed", newerStatus, fs.readFileSync(path.join(dir, "status.json"), "utf8"),
    );
    expect(readRunSpec(dir)?.prompt).toHaveLength(1024 * 1024);
    expect(openSqliteDatabase().prepare("SELECT status_json, source_spec FROM agent_runs WHERE id = ?").get(path.basename(dir))).toMatchObject({ status_json: newerStatus, source_spec: spec });
  });

  it("imports once when two processes open the same existing store", async () => {
    const dir = fixture("run-abc123-00000004");
    const source = ["spec.json", "status.json", "events.jsonl"].map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
    const worker = `
      const fs = require("node:fs");
      const path = require("node:path");
      const [modulePath, root, barrier, number] = process.argv.slice(1);
      const store = require(modulePath);
      fs.writeFileSync(path.join(barrier, number), "ready");
      const deadline = Date.now() + 8000;
      while (fs.readdirSync(barrier).length < 2) {
        if (Date.now() > deadline) throw new Error("worker barrier timed out");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      store.sqliteRunDirectories(root);
      store.sqliteAppendEvent(path.join(root, "run-abc123-00000004"), { type: "text", text: number, seq: 2, ts: 2 });
    `;
    const barrier = path.join(root, "barrier");
    fs.mkdirSync(barrier);
    const modulePath = path.resolve("../core/src/domains/storage/runs.ts");
    const results = await Promise.allSettled(["1", "2"].map((number) => execExternal(process.execPath,
      ["--import", "tsx", "-e", worker, modulePath, runs, barrier, number], { timeoutMs: 15000 })));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    expect(readRunEvents(dir, 0, 10)).toMatchObject({ next: 4, total: 4 });
    expect(openSqliteDatabase().prepare("SELECT COUNT(*) AS count FROM agent_runs").get()?.count).toBe(1);
    expect(["spec.json", "status.json", "events.jsonl"].map((name) => fs.readFileSync(path.join(dir, name), "utf8"))).toEqual(source);
  });

  it("imports claims and fails closed for malformed claims", async () => {
    const claims = path.join(runs, ".requests");
    fs.mkdirSync(claims, { recursive: true });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    fs.writeFileSync(path.join(claims, `${hash("existing")}.json`), JSON.stringify({ runId: "run-abc123-00000001" }));
    fs.writeFileSync(path.join(claims, `${hash("broken")}.json`), "{");
    expect(await readAgentRequest("existing")).toBe("run-abc123-00000001");
    expect(await claimAgentRequest("existing", "run-abc123-00000002")).toBe("run-abc123-00000001");
    await expect(readAgentRequest("broken")).rejects.toThrow("needs attention");
    await expect(claimAgentRequest("broken", "run-abc123-00000002")).rejects.toThrow("needs attention");
  });
});
