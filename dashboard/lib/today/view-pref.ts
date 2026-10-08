/**
 * The Today view choice, kept on the machine rather than in the browser.
 *
 * localStorage belongs to one origin, and the desktop app can be served from
 * 1337 or from a fallback port depending on what else is running, so the same
 * person saw a different choice depending on which port won. The server copy
 * (`~/.config/devhub/ui-prefs.json`, beside dashboard.json) is shared by every
 * origin; localStorage stays as the instant, offline-safe cache.
 */
import os from "node:os";
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";

export type TodayViewChoice = "focus" | "dashboard";

export function uiPrefsPath(home: string = os.homedir()): string {
  return path.join(home, ".config", "devhub", "ui-prefs.json");
}

export function isTodayViewChoice(value: unknown): value is TodayViewChoice {
  return value === "focus" || value === "dashboard";
}

/** The saved choice, or null when none was ever made on this machine. */
export function readTodayViewPref(file: string = uiPrefsPath()): TodayViewChoice | null {
  const stored = safeReadJSON<{ todayView?: unknown } | null>(file, null);
  return isTodayViewChoice(stored?.todayView) ? stored.todayView : null;
}

export async function writeTodayViewPref(view: TodayViewChoice, file: string = uiPrefsPath()): Promise<void> {
  await withMutex(file, async () => {
    // Keep any other preference stored beside it.
    const current = safeReadJSON<Record<string, unknown> | null>(file, null);
    const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    await writeAtomic(file, JSON.stringify({ ...base, todayView: view }, null, 2) + "\n");
  });
}
