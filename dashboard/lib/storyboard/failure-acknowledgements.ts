import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "@/lib/atomic-write";
import { getNotesDir } from "@/lib/notes/dir";
import { TaskIdSchema } from "./schema";

function fileFor(taskId: string, notesDir: string) {
  TaskIdSchema.parse(taskId);
  return path.join(notesDir, ".config", "storyboard", "failure-acknowledgements", `${taskId}.json`);
}

export function readFailureAcknowledgement(taskId: string, notesDir = getNotesDir()): string | undefined {
  try {
    const key = (JSON.parse(fs.readFileSync(fileFor(taskId, notesDir), "utf8")) as { key?: unknown }).key;
    return typeof key === "string" ? key : undefined;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Acknowledges only this failure. A new run/error has a different key and becomes visible again. */
export async function acknowledgeFailure(taskId: string, key: string | null, notesDir = getNotesDir()) {
  const file = fileFor(taskId, notesDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify({ key, at: new Date().toISOString() }) + "\n");
}
