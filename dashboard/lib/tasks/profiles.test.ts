import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let tasksRoot: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["REPO_ROOT", "TASKS_DIR", "DEVHUB_CONFIG_DIR", "DEVHUB_PROFILE"] as const;

// Every path helper reads env per call, so a cached module is fine; the
// counter only keeps each test's storage mutex/write chain separate.
let importSeq = 0;
async function fresh<T>(file: string): Promise<T> {
  return (await import(/* @vite-ignore */ new URL(file, import.meta.url).href + `?t=${Date.now()}${importSeq++}`)) as T;
}

function task(id: string, text: string, extra: Record<string, unknown> = {}) {
  return { id, text, done: false, createdAt: "2026-09-29T09:00:00.000Z", ...extra };
}

function writeDay(profile: string | null, date: string, tasks: unknown[]) {
  const dir = profile ? path.join(tasksRoot, profile) : tasksRoot;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.json`), JSON.stringify(tasks));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-profiles-"));
  tasksRoot = path.join(tmp, "tasks");
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.REPO_ROOT = tmp;
  process.env.TASKS_DIR = tasksRoot;
  process.env.DEVHUB_CONFIG_DIR = path.join(tmp, "config");
  delete process.env.DEVHUB_PROFILE;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("task profile resolution", () => {
  it("stays in the legacy layout until a profile exists", async () => {
    writeDay(null, "2026-09-29", [task("a", "legacy")]);
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    expect(m.resolveActiveProfileId(tasksRoot)).toBeNull();
    expect(m.resolveActiveTasksDir(tasksRoot)).toBe(tasksRoot);
  });

  it("uses the machine's chosen profile even when its directory is missing", async () => {
    writeDay("home", "2026-09-29", [task("a", "home task")]);
    process.env.DEVHUB_PROFILE = "work";
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    // Falling back to `home` here would write work tasks into home.
    expect(m.resolveActiveTasksDir(tasksRoot)).toBe(path.join(tasksRoot, "work"));
  });

  it("falls back to the first profile when the machine never chose", async () => {
    writeDay("work", "2026-09-29", []);
    writeDay("home", "2026-09-29", []);
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    expect(m.resolveActiveProfileId(tasksRoot)).toBe("home");
  });

  it("rejects path-traversal and date-shaped ids", async () => {
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    for (const bad of ["", "../etc", "a/b", "Work", "2026-09-29", "x".repeat(40)]) {
      expect(m.isValidProfileId(bad)).toBe(false);
    }
    expect(() => m.createTaskProfile(tasksRoot, "../evil")).toThrow();
    expect(() => m.writeActiveProfileId("../evil")).toThrow();
    expect(m.isValidProfileId("home")).toBe(true);
    expect(m.isValidProfileId("client-a_2")).toBe(true);
  });

  it("first profile adopts legacy day-files; later ones don't", async () => {
    writeDay(null, "2026-09-28", [task("a", "old")]);
    writeDay(null, "2026-09-29", [task("b", "new")]);
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    expect(m.createTaskProfile(tasksRoot, "home")).toEqual({ adopted: 2 });
    expect(m.listLegacyDayFiles(tasksRoot)).toEqual([]);
    expect(fs.existsSync(path.join(tasksRoot, "home", "2026-09-28.json"))).toBe(true);
    expect(m.createTaskProfile(tasksRoot, "work")).toEqual({ adopted: 0 });
    expect(m.listTaskProfiles(tasksRoot)).toEqual(["home", "work"]);
  });

  it("reserves deleted and adopts tombstones into the first profile", async () => {
    fs.mkdirSync(path.join(tasksRoot, "deleted"), { recursive: true });
    fs.writeFileSync(
      path.join(tasksRoot, "deleted", "gone.json"),
      JSON.stringify({ id: "gone", deleted: true, legacyIds: ["gone"] }),
    );
    fs.mkdirSync(path.join(tasksRoot, "items"), { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, "items", "a.json"), JSON.stringify(task("a", "kept")));
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    expect(m.isValidProfileId("deleted")).toBe(false);
    expect(m.isValidProfileId("items")).toBe(false);
    expect(m.isValidProfileId("legacy")).toBe(false);
    expect(m.listTaskProfiles(tasksRoot)).toEqual([]);
    expect(() => m.createTaskProfile(tasksRoot, "deleted")).toThrow();
    expect(m.createTaskProfile(tasksRoot, "home")).toEqual({ adopted: 2 });
    expect(fs.existsSync(path.join(tasksRoot, "home", "deleted", "gone.json"))).toBe(true);
    expect(fs.existsSync(path.join(tasksRoot, "home", "items", "a.json"))).toBe(true);
    expect(fs.existsSync(path.join(tasksRoot, "deleted", "gone.json"))).toBe(false);
    expect(m.listTaskProfiles(tasksRoot)).toEqual(["home"]);
  });

  it("adopt never overwrites an existing profile file", async () => {
    writeDay("home", "2026-09-29", [task("keep", "keep me")]);
    writeDay(null, "2026-09-29", [task("stray", "stray")]);
    const m = await fresh<typeof import("@shared/vault/task-profiles")>("../../../shared/vault/task-profiles.ts");
    expect(m.adoptLegacyDayFiles(tasksRoot, "home")).toBe(0);
    const kept = JSON.parse(fs.readFileSync(path.join(tasksRoot, "home", "2026-09-29.json"), "utf-8"));
    expect(kept[0].id).toBe("keep");
  });
});

describe("profile-scoped storage", () => {
  it("writes only into the active profile and never touches the other", async () => {
    writeDay("home", "2026-09-29", [task("h1", "home task")]);
    fs.mkdirSync(path.join(tasksRoot, "work"), { recursive: true });
    process.env.DEVHUB_PROFILE = "work";
    const storage = await fresh<typeof import("./storage")>("./storage.ts");

    const added = await storage.addTask("work task", "2026-09-29");
    expect(storage.getTasks("2026-09-29").map((t) => t.id)).toEqual([added.id]);

    expect(fs.existsSync(path.join(tasksRoot, "home", "2026-09-29.json"))).toBe(false);
    const homeItems = fs.readdirSync(path.join(tasksRoot, "home", "items")).filter((name) => name.endsWith(".json"));
    const homeTexts = homeItems.map((name) => JSON.parse(fs.readFileSync(path.join(tasksRoot, "home", "items", name), "utf-8")).text);
    expect(homeTexts).toEqual(["home task"]);
  });

  it("keeps each profile's open tasks separate", async () => {
    writeDay("home", "2026-09-01", [task("h1", "home old")]);
    writeDay("work", "2026-09-01", [task("w1", "work old")]);
    process.env.DEVHUB_PROFILE = "work";
    const storage = await fresh<typeof import("./storage")>("./storage.ts");
    await storage.ensureTasksMigrated();
    expect(storage.getTasks().map((item) => item.text)).toEqual(["work old"]);

    process.env.DEVHUB_PROFILE = "home";
    const home = await fresh<typeof import("./storage")>("./storage.ts");
    expect(home.getTasks().map((item) => item.text)).toEqual(["home old"]);
  });
});

describe("profile overview", () => {
  it("overlays the other profile's open tasks", async () => {
    writeDay("home", "2026-09-20", [task("old", "ancient")]);
    writeDay("home", "2026-09-29", [
      task("open", "buy filament"),
      task("done", "finished", { done: true }),
      task("moved", "moved on", { movedAt: "2026-09-29T10:00:00.000Z" }),
    ]);
    writeDay("work", "2026-09-29", [task("w", "ship it")]);
    process.env.DEVHUB_PROFILE = "work";
    const storage = await fresh<typeof import("./storage")>("./storage.ts");
    await storage.ensureTasksMigrated();
    const { getTaskProfileOverview } = await fresh<typeof import("./profiles")>("./profiles.ts");

    const overview = getTaskProfileOverview();
    expect(overview.mode).toBe("profiles");
    expect(overview.active).toBe("work");
    expect(overview.overlay).toHaveLength(1);
    expect(overview.overlay[0]).toMatchObject({ profileId: "home" });
    expect(overview.overlay[0]!.tasks.map((t) => t.id).sort()).toEqual(["old", "open"]);
  });

  it("omits profiles with nothing open and reports legacy mode with no profiles", async () => {
    writeDay(null, "2026-09-29", [task("a", "legacy")]);
    const { getTaskProfileOverview } = await fresh<typeof import("./profiles")>("./profiles.ts");
    expect(getTaskProfileOverview()).toMatchObject({ mode: "legacy", active: null, legacyFiles: 1, overlay: [] });
  });

  it("create activates the profile and switch refuses unknown ones", async () => {
    const m = await fresh<typeof import("./profiles")>("./profiles.ts");
    expect(m.createAndActivateProfile("home")).toEqual({ adopted: 0 });
    expect(m.createAndActivateProfile("work")).toEqual({ adopted: 0 });
    expect(m.getTaskProfileOverview().active).toBe("work");
    expect(m.switchProfile("home")).toBe(true);
    expect(m.getTaskProfileOverview().active).toBe("home");
    expect(m.switchProfile("nope")).toBe(false);
  });
});
