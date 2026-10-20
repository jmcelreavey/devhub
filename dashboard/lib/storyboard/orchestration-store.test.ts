import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listOrchestrations, mutateOrchestration, newOrchestration, orchestrationsDir, readOrchestration } from "./orchestration-store";
import { StoryboardError } from "./errors";
import { DEFAULT_MODEL_TIERS } from "./model-tiers-shared";

let notes: string;
const TASK = "task-abc";
const fresh = () => newOrchestration({ taskId: TASK, taskDate: "2026-10-15" }, "2026-10-15T09:00:00.000Z");

beforeEach(() => { notes = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-orchestration-")); });
afterEach(() => { fs.rmSync(notes, { recursive: true, force: true }); });

describe("orchestration store", () => {
  it("returns null for a task that was never started", () => {
    expect(readOrchestration(TASK, notes)).toBeNull();
  });

  it("writes notes/.config/storyboard/orchestrations/<taskId>.json at revision 1", async () => {
    const result = await mutateOrchestration(TASK, "key-00000001", () => fresh(), notes);
    expect(result.created).toBe(true);
    expect(result.record.revision).toBe(1);
    expect(fs.existsSync(path.join(notes, ".config", "storyboard", "orchestrations", TASK + ".json"))).toBe(true);
    expect(readOrchestration(TASK, notes)?.status).toBe("starting");
  });

  it("keeps the tiers chosen at kickoff across a write and a read", async () => {
    await mutateOrchestration(TASK, "key-00000001", () => ({ ...fresh(), tiers: DEFAULT_MODEL_TIERS }), notes);
    expect(readOrchestration(TASK, notes)?.tiers).toEqual(DEFAULT_MODEL_TIERS);
  });

  it("replays a repeated idempotency key without applying the change again", async () => {
    await mutateOrchestration(TASK, "key-00000001", () => fresh(), notes);
    const replay = await mutateOrchestration(TASK, "key-00000001", (current) => ({ ...current!, status: "stopped" }), notes);
    expect(replay.replayed).toBe(true);
    expect(readOrchestration(TASK, notes)).toMatchObject({ revision: 1, status: "starting" });
  });

  it("does not write when the change returns null", async () => {
    await mutateOrchestration(TASK, "key-00000001", () => fresh(), notes);
    const result = await mutateOrchestration(TASK, "key-00000002", () => null, notes);
    expect(result).toMatchObject({ replayed: false, created: false });
    expect(readOrchestration(TASK, notes)?.revision).toBe(1);
  });

  it("bumps the revision on each change", async () => {
    await mutateOrchestration(TASK, null, () => fresh(), notes);
    const next = await mutateOrchestration(TASK, null, (current) => ({ ...current!, status: "running", runIds: ["run-1"] }), notes);
    expect(next.record).toMatchObject({ revision: 2, status: "running", runIds: ["run-1"] });
  });

  it("refuses an invalid task ID before touching the filesystem", async () => {
    expect(() => readOrchestration("../escape", notes)).toThrow(StoryboardError);
    await expect(mutateOrchestration("../escape", null, () => fresh(), notes)).rejects.toThrow(StoryboardError);
  });

  it("treats a corrupt file as an error, never as no orchestration", async () => {
    fs.mkdirSync(orchestrationsDir(notes), { recursive: true });
    fs.writeFileSync(path.join(orchestrationsDir(notes), TASK + ".json"), "{not json");
    expect(() => readOrchestration(TASK, notes)).toThrow(/not valid JSON/);
    fs.writeFileSync(path.join(orchestrationsDir(notes), TASK + ".json"), JSON.stringify({ schemaVersion: 1, taskId: TASK }));
    expect(() => readOrchestration(TASK, notes)).toThrow(/corrupt/);
    await expect(mutateOrchestration(TASK, null, () => fresh(), notes)).rejects.toThrow(/corrupt/);
  });

  it("refuses a file from a newer DevHub with 409", () => {
    fs.mkdirSync(orchestrationsDir(notes), { recursive: true });
    fs.writeFileSync(path.join(orchestrationsDir(notes), TASK + ".json"), JSON.stringify({ schemaVersion: 99 }));
    const error = (() => { try { readOrchestration(TASK, notes); } catch (cause) { return cause; } })() as StoryboardError;
    expect(error.status).toBe(409);
  });

  it("lists every record and reports corrupt files without hiding the rest", async () => {
    await mutateOrchestration(TASK, null, () => fresh(), notes);
    fs.writeFileSync(path.join(orchestrationsDir(notes), "broken.json"), "[]");
    const { records, errors } = listOrchestrations(notes);
    expect(records.map((record) => record.taskId)).toEqual([TASK]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^broken\.json/);
  });
});
