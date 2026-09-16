/**
 * Turn new on-call alerts into draft tasks ("Investigate: <alert>").
 *
 * Opt-in (off by default): creating tasks on your behalf is surprising. Drafts
 * only — nothing is ever dispatched from an alert. Each alert is drafted once;
 * recoveries are ignored. Runs on the task PR watcher's tick.
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { loadRecentAlerts } from "@/lib/datadog/recent-server";
import { datadogAppOrigin } from "@/lib/datadog/links";
import type { RecentEvent } from "@/lib/datadog/recent-events";
import { captureDraftTask } from "@/lib/tasks/capture";

interface AlertDraftsFile {
  version: 1;
  enabled: boolean;
  /** Datadog event id → draft task id. */
  drafted: Record<string, string>;
}

const EMPTY: AlertDraftsFile = { version: 1, enabled: false, drafted: {} };
/** Keep the dedupe map bounded; alerts older than the 24h window never come back. */
const MAX_REMEMBERED = 500;

function filePath(): string {
  return path.join(getNotesDir(), ".config", "alert-drafts.json");
}

function read(): AlertDraftsFile {
  const raw = safeReadJSON<Partial<AlertDraftsFile>>(filePath(), EMPTY);
  return { version: 1, enabled: raw.enabled === true, drafted: raw.drafted ?? {} };
}

export function readAlertDraftsEnabled(): boolean {
  return read().enabled;
}

export async function setAlertDraftsEnabled(enabled: boolean): Promise<boolean> {
  const file = filePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ ...read(), enabled }, null, 2));
  });
  return enabled;
}

/** A firing alert worth investigating — not a recovery or an OK transition. */
export function isFiringAlert(event: Pick<RecentEvent, "title" | "status">): boolean {
  const status = (event.status ?? "").toLowerCase();
  if (["success", "ok", "info"].includes(status)) return false;
  return !/^\s*\[(recovered|ok)\b/i.test(event.title);
}

export async function draftTasksFromAlerts(): Promise<number> {
  if (!read().enabled) return 0;
  const load = await loadRecentAlerts(10);
  if (!load.ok) return 0;
  const origin = datadogAppOrigin(load.ddSite);
  const file = filePath();
  return withMutex(file, async () => {
    const state = read();
    let created = 0;
    for (const event of load.oncall.filter(isFiringAlert)) {
      if (state.drafted[event.id]) continue;
      const url = `${origin}/event/event?id=${encodeURIComponent(event.id)}`;
      const { task } = await captureDraftTask({
        text: `Investigate: ${event.title}`.slice(0, 500),
        detail: `Drafted from an on-call alert at ${new Date(event.timestampMs).toISOString()}: ${url}`,
      });
      state.drafted[event.id] = task.id;
      created += 1;
    }
    const ids = Object.keys(state.drafted);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED))) delete state.drafted[id];
    if (created > 0) await writeAtomic(file, JSON.stringify(state, null, 2));
    return created;
  });
}
