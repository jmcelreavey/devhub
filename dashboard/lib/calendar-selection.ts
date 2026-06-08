import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { getRepoRoot } from "@/lib/notes-dir";

interface CalendarSelectionFile {
  version: 1;
  calendarIds: string[];
}

const SELECTION_DIR = ".devhub";
const SELECTION_FILE = "calendar-selection.json";

function selectionPath(): string {
  return path.join(getRepoRoot(), SELECTION_DIR, SELECTION_FILE);
}

function defaultSelection(): CalendarSelectionFile {
  return { version: 1, calendarIds: [] };
}

/** Locally saved calendar IDs; empty means “use Google/default selection”. */
export function readCalendarSelection(): string[] {
  const parsed = safeReadJSON<CalendarSelectionFile>(selectionPath(), defaultSelection());
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.calendarIds)) return [];
  return parsed.calendarIds.filter((id) => typeof id === "string" && id.trim().length > 0);
}

export function hasSavedCalendarSelection(): boolean {
  return readCalendarSelection().length > 0;
}

export async function writeCalendarSelection(calendarIds: string[]): Promise<string[]> {
  const ids = [...new Set(calendarIds.map((id) => id.trim()).filter(Boolean))];
  await withMutex(`calendar-selection:${getRepoRoot()}`, async () => {
    const dir = path.dirname(selectionPath());
    fs.mkdirSync(dir, { recursive: true });
    const file: CalendarSelectionFile = { version: 1, calendarIds: ids };
    await writeAtomic(selectionPath(), JSON.stringify(file, null, 2) + "\n");
  });
  return ids;
}
