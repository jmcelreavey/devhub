import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";

/**
 * Orchestration records live beside task workflows in `notes/.config/` — small,
 * git-tracked in the private mirror, synced. Media and caches do not belong here.
 */
export function storyboardDir(notesDir = getNotesDir()): string {
  return path.join(notesDir, ".config", "storyboard");
}

export class StoryboardError extends Error {
  constructor(message: string, readonly status: number, readonly currentRevision?: number) {
    super(message);
    this.name = "StoryboardError";
  }
}
