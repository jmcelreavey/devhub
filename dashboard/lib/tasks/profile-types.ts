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
}
