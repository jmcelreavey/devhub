import fs from "node:fs";
import path from "node:path";
import { getTasksDir } from "@/lib/notes/dir";
import {
  adoptLegacyDayFiles,
  createTaskProfile,
  listLegacyDayFiles,
  listTaskProfiles,
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
