/** Client-safe shapes for task profiles (no node imports). */
import type { Task } from "@/lib/tasks/types";

/** Open tasks another profile carries, shown read-only beside the active one. */
export interface ProfileOverlay {
  profileId: string;
  /** The day-file the tasks came from (the profile's newest). */
  date: string;
  tasks: Task[];
}

export interface TaskProfileOverview {
  /** "legacy" = day-files live directly in the tasks root; no profiles yet. */
  mode: "legacy" | "profiles";
  active: string | null;
  profiles: string[];
  /** Root-level day-files still waiting to be moved into a profile. */
  legacyFiles: number;
  overlay: ProfileOverlay[];
  /** The repo-wide fallback for machines that never chose (tasks/profiles.json). It can't be deleted. */
  defaultProfile?: string | null;
  /** Tasks per profile: open (what the picker shows) and total (what a delete would move). */
  counts?: Record<string, { open: number; total: number }>;
}
