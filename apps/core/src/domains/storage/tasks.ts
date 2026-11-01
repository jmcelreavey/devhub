import type { TaskStorage } from "../../../../../packages/shared/storage/contracts.ts";
import { createFileTaskStorage } from "./file-tasks.ts";

/** Files remain authoritative until a verified per-scope SQLite cutover. */
export function taskStorage(directory: string): TaskStorage {
  return createFileTaskStorage(directory);
}
