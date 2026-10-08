import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const migrate = vi.hoisted(() => vi.fn(async () => ({ notice: "" })));
vi.mock("@shared/tasks/migrate.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/tasks/migrate.ts")>()),
  migrateTasksRoot: migrate,
}));

import { ensureTasksMigrated, migrationAllowed } from "./storage";

let root: string;
beforeEach(() => {
  migrate.mockClear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-guard-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("task migration guard", () => {
  it("runs in tests only against an explicit temp content root", async () => {
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    expect(migrationAllowed()).toBe(true);
    await ensureTasksMigrated();
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("never touches the checkout's own tasks/ in tests", async () => {
    vi.stubEnv("TASKS_DIR", "");
    vi.stubEnv("REPO_ROOT", "");
    await ensureTasksMigrated();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not run during next build, even for a temp root", async () => {
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(migrationAllowed()).toBe(false);
    await ensureTasksMigrated();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not run in tests for a dir outside the temp root", () => {
    expect(migrationAllowed(path.join(process.cwd(), "tasks"))).toBe(false);
    expect(migrationAllowed(os.tmpdir())).toBe(false);
  });
});
