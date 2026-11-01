import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "../../domains/storage/sqlite";
import { exportRuns } from "../../domains/storage/export-runs";
import { appendRunEvent, readRunEvents, readRunSpec, readRunStatus, writeRunSpec, writeRunStatus } from "./run-files";
import { claimAgentRequest, readAgentRequest } from "./claims";

describe("SQLite run export", () => {
  let root: string;
  let runs: string;
  let dir: string;
  const id = "run-abc123-00000001";
  beforeEach(() => {
    vi.stubEnv("DEVHUB_STORAGE_URL", undefined);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-run-export-"));
    runs = path.join(root, "runs");
    dir = path.join(runs, id);
    fs.mkdirSync(path.join(runs, ".requests"), { recursive: true });
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "spec.json"), `{ "id": "${id}", "createdAt": 1 }\n`);
    fs.writeFileSync(path.join(dir, "status.json"), "{ \"state\": \"succeeded\", \"updatedAt\": 1, \"eventCount\": 1 }\n");
    fs.writeFileSync(path.join(dir, "events.jsonl"), "{\"type\":\"text\",\"text\":\"fixture\",\"seq\":0,\"ts\":1}\nbroken\n");
    const hash = createHash("sha256").update("request").digest("hex");
    fs.writeFileSync(path.join(runs, ".requests", `${hash}.json`), `{ "runId": "${id}" }\n`);
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

  it("exports unchanged imported records byte-for-byte, including corrupt lines and claims", async () => {
    expect(readRunSpec(dir)?.id).toBe(id);
    expect(await readAgentRequest("request")).toBe(id);
    const destination = path.join(root, "exported");
    expect(exportRuns(destination)).toEqual({ runs: 1, files: 4 });
    for (const name of ["spec.json", "status.json", "events.jsonl"]) {
      expect(fs.readFileSync(path.join(destination, id, name))).toEqual(fs.readFileSync(path.join(dir, name)));
    }
    expect(fs.readdirSync(path.join(destination, ".requests"))).toEqual(fs.readdirSync(path.join(runs, ".requests")));
    const claim = fs.readdirSync(path.join(runs, ".requests"))[0];
    expect(fs.readFileSync(path.join(destination, ".requests", claim))).toEqual(fs.readFileSync(path.join(runs, ".requests", claim)));
  });

  it("swaps updated database records into unchanged original folders", () => {
    readRunSpec(dir);
    const originalSpec = fs.readFileSync(path.join(dir, "spec.json"));
    writeRunStatus(dir, { state: "failed", updatedAt: 1, eventCount: 2 });
    appendRunEvent(dir, { type: "text", text: "new", seq: 1, ts: 2 });
    exportRuns(runs);
    expect(fs.readFileSync(path.join(dir, "spec.json"))).toEqual(originalSpec);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")).state).toBe("failed");
    expect(fs.readFileSync(path.join(dir, "events.jsonl"), "utf8")).toContain("\"text\":\"new\"");
  });

  it("refuses to overwrite a source changed after import", () => {
    readRunSpec(dir);
    writeRunStatus(dir, { state: "failed", updatedAt: 1, eventCount: 1 });
    fs.writeFileSync(path.join(dir, "status.json"), "newer source");
    expect(() => exportRuns(runs)).toThrow("newer or unverified");
    expect(fs.readFileSync(path.join(dir, "status.json"), "utf8")).toBe("newer source");
  });

  it("restores the original run directory if the export transaction fails after installation", () => {
    readRunSpec(dir);
    const originalStatus = fs.readFileSync(path.join(dir, "status.json"), "utf8");
    writeRunStatus(dir, { state: "failed", updatedAt: 2, eventCount: 1 });
    const db = openSqliteDatabase();
    const exec = db.exec.bind(db);
    let commits = 0;
    const spy = vi.spyOn(db, "exec").mockImplementation((sql) => {
      if (sql === "COMMIT" && ++commits === 2) throw new Error("injected commit failure");
      return exec(sql);
    });
    try {
      expect(() => exportRuns(runs)).toThrow("injected commit failure");
      expect(fs.readFileSync(path.join(dir, "status.json"), "utf8")).toBe(originalStatus);
      expect(readRunStatus(dir)?.state).toBe("failed");
    } finally {
      spy.mockRestore();
    }
  });

  it("exports imported and new runs and claims for the file backend", async () => {
    expect(readRunSpec(dir)?.id).toBe(id);
    writeRunStatus(dir, { state: "failed", updatedAt: 2, eventCount: 2 });
    appendRunEvent(dir, { type: "text", text: "after import", seq: 1, ts: 2 });
    const newId = "run-abc123-00000002";
    const newDir = path.join(runs, newId);
    fs.mkdirSync(newDir);
    writeRunSpec(newDir, { id: newId, provider: "fixture", providerLabel: "Fixture", bin: "fixture", args: [], format: "text", cwd: root, title: "Fixture", prompt: "", depth: 0, createdAt: 2 });
    writeRunStatus(newDir, { state: "succeeded", updatedAt: 2, eventCount: 1 });
    appendRunEvent(newDir, { type: "text", text: "new run", seq: 0, ts: 2 });
    expect(await claimAgentRequest("new request", newId)).toBe(newId);

    exportRuns(runs);
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    expect(readRunSpec(dir)?.id).toBe(id);
    expect(readRunStatus(dir)?.state).toBe("failed");
    const first = readRunEvents(dir, 0, 1);
    const second = readRunEvents(dir, first.next, 1);
    expect(first.events).toMatchObject([{ type: "text", text: "fixture" }]);
    expect(second).toMatchObject({ next: 2, total: 2, events: [{ type: "text", text: "after import" }] });
    expect(readRunSpec(newDir)?.id).toBe(newId);
    expect(readRunStatus(newDir)?.state).toBe("succeeded");
    expect(readRunEvents(newDir).events).toHaveLength(1);
    expect(await readAgentRequest("new request")).toBe(newId);
  });
});
