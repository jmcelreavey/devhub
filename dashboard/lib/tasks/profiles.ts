import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getTasksDir } from "@/lib/notes/dir";
import {
  adoptLegacyDayFiles,
  createTaskProfile,
  listLegacyDayFiles,
  listTaskProfiles,
  readDefaultProfileId,
  resolveActiveProfileId,
  writeActiveProfileId,
} from "@shared/vault/task-profiles.ts";
import { todayISO } from "@/lib/utils";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import { readItems } from "@shared/tasks/store.ts";
import type { ProfileOverlay, TaskProfileOverview } from "@/lib/tasks/profile-types";

/**
 * A profile's open tasks. An open item stays visible until it ends, so the
 * overlay is the open set rather than whatever the newest day file happened to hold.
 */
function readOverlay(root: string, profileId: string): ProfileOverlay | null {
  const dir = path.join(root, profileId);
  if (!fs.existsSync(dir)) return null;
  let tasks: Task[] = [];
  try {
    tasks = readItems(dir).filter(isTaskOpen);
  } catch {
    return null;
  }
  if (tasks.length === 0) return null;
  return { profileId, date: todayISO(), tasks };
}

export function getTaskProfileOverview(): TaskProfileOverview {
  const root = getTasksDir();
  const profiles = listTaskProfiles(root);
  const active = resolveActiveProfileId(root);
  const overlay = profiles
    .filter((id) => id !== active)
    .map((id) => readOverlay(root, id))
    .filter((group): group is ProfileOverlay => group !== null && group.tasks.length > 0);
  return {
    mode: active ? "profiles" : "legacy",
    active,
    profiles,
    legacyFiles: listLegacyDayFiles(root).length,
    overlay,
    defaultProfile: readDefaultProfileId(root),
    counts: Object.fromEntries(profiles.map((id) => [id, countTasks(root, id)])),
  };
}

function countTasks(root: string, profileId: string): { open: number; total: number } {
  try {
    const tasks = readItems(path.join(root, profileId));
    return { open: tasks.filter(isTaskOpen).length, total: tasks.length };
  } catch {
    return { open: 0, total: 0 };
  }
}

/** A refused profile change, with the HTTP status the route should answer. */
export class ProfileError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Every file under `dir`, relative to it (timers in `.local/` included: they are this machine's, but never dropped). */
function filesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
    else out.push(rel);
  }
  return out;
}

/** `git mv`, so history follows the task; a file git doesn't track yet is renamed on disk instead. */
function moveFile(root: string, from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    execFileSync("git", ["-C", root, "mv", from, to], { stdio: "pipe" });
  } catch {
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  if (fs.existsSync(from) || !fs.existsSync(to)) throw new ProfileError(`Couldn't move ${path.basename(from)}; nothing was deleted.`, 500);
}

/** Remove directories that are empty, deepest first. Never removes a file. */
function removeEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * Delete a profile. Never the active one or the repo default. A profile that still has files needs
 * `moveTo`: every file moves there first (git mv), and the operation stops before moving anything if
 * a file of the same name already exists. Only empty directories are ever removed.
 */
export function deleteProfile(id: string, moveTo?: string): { moved: number } {
  const root = getTasksDir();
  const profiles = listTaskProfiles(root);
  if (!profiles.includes(id)) throw new ProfileError(`No profile named "${id}".`, 404);
  if (id === resolveActiveProfileId(root)) throw new ProfileError(`"${id}" is the profile this machine uses. Switch to another one first.`, 409);
  if (id === readDefaultProfileId(root)) throw new ProfileError(`"${id}" is the default profile for machines that never chose one, so it can't be deleted.`, 409);
  const dir = path.join(root, id);
  const files = filesUnder(dir);
  if (files.length > 0) {
    if (!moveTo) throw new ProfileError(`"${id}" still has tasks. Choose a profile to move them to.`, 409);
    if (moveTo === id || !profiles.includes(moveTo)) throw new ProfileError(`No profile named "${moveTo}" to move the tasks to.`, 400);
    const target = path.join(root, moveTo);
    const clash = files.find((file) => fs.existsSync(path.join(target, file)));
    if (clash) throw new ProfileError(`${moveTo} already has ${clash}; nothing was moved.`, 409);
    for (const file of files) moveFile(root, path.join(dir, file), path.join(target, file));
  }
  removeEmptyDirs(dir);
  return { moved: files.length };
}

/** Create a profile (adopting legacy files if it is the first) and make it this machine's active one. */
export function createAndActivateProfile(id: string): { adopted: number } {
  const result = createTaskProfile(getTasksDir(), id);
  writeActiveProfileId(id);
  return result;
}

export function switchProfile(id: string): boolean {
  if (!listTaskProfiles(getTasksDir()).includes(id)) return false;
  writeActiveProfileId(id);
  return true;
}

/** Move stray root-level day-files (e.g. from a machine on an older build) into the active profile. */
export function adoptLegacyIntoActive(): number {
  const root = getTasksDir();
  const active = resolveActiveProfileId(root);
  return active ? adoptLegacyDayFiles(root, active) : 0;
}
