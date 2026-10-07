import fs from "node:fs";
import path from "node:path";
import { getTasksDir } from "@/lib/notes/dir";
import { safeReadJSON } from "@/lib/atomic-write";
import {
  adoptLegacyDayFiles,
  createTaskProfile,
  listLegacyDayFiles,
  listTaskProfiles,
  resolveActiveProfileId,
  writeActiveProfileId,
} from "@shared/vault/task-profiles.ts";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import type { ProfileOverlay, TaskProfileOverview } from "@/lib/tasks/profile-types";

const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

/**
 * A profile's open tasks, from its newest day-file. Rollover carries open work
 * forward, so the newest file is the whole open set — no need to walk history.
 */
function readOverlay(root: string, profileId: string): ProfileOverlay | null {
  const dir = path.join(root, profileId);
  let newest: string | undefined;
  try {
    newest = fs.readdirSync(dir).filter((name) => DAY_FILE_RE.test(name)).sort().pop();
  } catch {
    return null;
  }
  if (!newest) return null;
  const tasks = safeReadJSON<Task[]>(path.join(dir, newest), []).filter(isTaskOpen);
  return { profileId, date: newest.replace(/\.json$/, ""), tasks };
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
  };
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
