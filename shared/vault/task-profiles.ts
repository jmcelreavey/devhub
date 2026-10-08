/**
 * Task profiles: `tasks/<profile>/items/<id>.json`.
 *
 * A profile (home, work, …) is a subdirectory of the tasks root. The whole tree
 * lives in one git repo, but each machine only ever WRITES to its own active
 * profile, so two machines never edit the same file and `git pull` stays a
 * fast-forward. The other profiles are read-only overlay data.
 *
 * Which profile is active is per-machine and deliberately NOT in the repo:
 * `DEVHUB_PROFILE`, else `~/.config/devhub/profile.json`.
 *
 * Legacy layout (no profile dirs) keeps tasks in `tasks/items/`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
/** Item storage, delete tombstones and the imported day-file archive. Not profile names. */
const RESERVED_DIRS = new Set(["items", "legacy", "deleted"]);

export function isValidProfileId(id: string): boolean {
  // A date-shaped directory name would be indistinguishable from a day.
  return PROFILE_ID_RE.test(id) && !DAY_RE.test(id) && !RESERVED_DIRS.has(id);
}

function configDir(): string {
  return process.env.DEVHUB_CONFIG_DIR || path.join(os.homedir(), ".config", "devhub");
}

function activeProfileFile(): string {
  return path.join(configDir(), "profile.json");
}

/** Profile ids present under the tasks root, sorted. Empty = legacy layout. */
export function listTaskProfiles(tasksRoot: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && isValidProfileId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** This machine's chosen profile id, or null when it never chose one. */
export function readActiveProfileId(): string | null {
  const fromEnv = process.env.DEVHUB_PROFILE?.trim();
  if (fromEnv && isValidProfileId(fromEnv)) return fromEnv;
  try {
    const parsed = JSON.parse(fs.readFileSync(activeProfileFile(), "utf-8")) as { active?: unknown };
    return typeof parsed.active === "string" && isValidProfileId(parsed.active) ? parsed.active : null;
  } catch {
    return null;
  }
}

export function writeActiveProfileId(id: string): void {
  if (!isValidProfileId(id)) throw new Error(`Invalid profile id: ${id}`);
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(activeProfileFile(), `${JSON.stringify({ active: id }, null, 2)}\n`, "utf-8");
}

/**
 * The profile this machine writes to, or null in the legacy layout.
 *
 * A chosen profile wins even if its directory doesn't exist yet (fresh clone,
 * nothing committed for it) — falling back to another profile there would
 * silently write work tasks into home.
 */
export function resolveActiveProfileId(tasksRoot: string): string | null {
  const profiles = listTaskProfiles(tasksRoot);
  if (profiles.length === 0) return null;
  const chosen = readActiveProfileId();
  return chosen ?? profiles[0]!;
}

/** Directory holding the active profile's items (the root itself when there are no profiles). */
export function resolveActiveTasksDir(tasksRoot: string): string {
  const id = resolveActiveProfileId(tasksRoot);
  return id ? path.join(tasksRoot, id) : tasksRoot;
}

/** Day-files sitting directly in the root — pre-profile data that needs adopting. */
export function listLegacyDayFiles(tasksRoot: string): string[] {
  try {
    return fs.readdirSync(tasksRoot).filter((name) => DAY_FILE_RE.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * Create a profile directory. The first profile also adopts any legacy
 * day-files (plain rename, so git records them as renames and keeps history).
 * Returns how many legacy files were adopted.
 */
export function createTaskProfile(tasksRoot: string, id: string): { adopted: number } {
  if (!isValidProfileId(id)) throw new Error(`Invalid profile id: ${id}`);
  const profileDir = path.join(tasksRoot, id);
  const isFirstProfile = listTaskProfiles(tasksRoot).length === 0;
  fs.mkdirSync(profileDir, { recursive: true });
  if (!isFirstProfile) return { adopted: 0 };
  return { adopted: adoptLegacyDayFiles(tasksRoot, id) };
}

function moveUnique(source: string, target: string): boolean {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
  return true;
}

/**
 * Move root-level day-files, imported items, and the legacy archive into a profile.
 * Never overwrites an existing file.
 */
export function adoptLegacyDayFiles(tasksRoot: string, id: string): number {
  if (!isValidProfileId(id)) throw new Error(`Invalid profile id: ${id}`);
  const profileDir = path.join(tasksRoot, id);
  fs.mkdirSync(profileDir, { recursive: true });
  let adopted = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(tasksRoot);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (/^\d{4}-\d{2}-\d{2}(?:\.local)?\.json$/.test(name) && moveUnique(path.join(tasksRoot, name), path.join(profileDir, name))) {
      adopted += 1;
    }
  }
  for (const bucket of ["items", "legacy", "deleted"] as const) {
    const from = path.join(tasksRoot, bucket);
    if (!fs.existsSync(from)) continue;
    for (const name of fs.readdirSync(from)) {
      if (moveUnique(path.join(from, name), path.join(profileDir, bucket, name))) adopted += 1;
    }
  }
  return adopted;
}
