import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureTasksMigrated, migrationAllowed } from "./storage";

let root: string;
const taskId = "11111111-1111-4111-8111-111111111111";

function writeLegacyTask(): string {
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, "2026-10-26.json");
  fs.writeFileSync(file, JSON.stringify([{ id: taskId, text: "Keep this task", done: false, rank: "1", startDate: "2026-10-26", createdAt: "2026-10-26T12:00:00.000Z" }]));
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-guard-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", "");
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("DEVHUB_TASK_MIGRATION_DIR", path.join(root, "migrations"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("task migration guard", () => {
  it("runs in tests only against an explicit temp content root", async () => {
    writeLegacyTask();
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    expect(migrationAllowed()).toBe(true);
    await ensureTasksMigrated();
    const item = JSON.parse(fs.readFileSync(path.join(root, "tasks", "items", `${taskId}.json`), "utf8"));
    expect(item).toMatchObject({ id: taskId, text: "Keep this task" });
  });

  it("never migrates an implicit checkout tasks directory, even inside the temp root", async () => {
    const file = writeLegacyTask();
    const before = fs.readFileSync(file, "utf8");
    await ensureTasksMigrated();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
    expect(fs.existsSync(path.join(root, "migrations"))).toBe(false);
  });

  it("does not run during next build, even for a temp root", async () => {
    const file = writeLegacyTask();
    const before = fs.readFileSync(file, "utf8");
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(migrationAllowed()).toBe(false);
    await ensureTasksMigrated();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it("does not run in tests for a dir outside the temp root", () => {
    vi.stubEnv("TASKS_DIR", path.parse(os.tmpdir()).root);
    expect(migrationAllowed()).toBe(false);
    vi.stubEnv("TASKS_DIR", os.tmpdir());
    expect(migrationAllowed()).toBe(false);
  });

  it("only migrates the explicitly configured tasks directory", () => {
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    expect(migrationAllowed(path.join(root, "other"))).toBe(false);
  });
});
