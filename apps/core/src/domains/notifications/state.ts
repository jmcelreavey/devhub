import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { safeReadJSON, withMutex, writeAtomic } from "../../lib/atomic-write";
import type { Notification } from "../../../../../packages/shared/notifications/types";

const entry = z.object({ read: z.string().optional(), dismissed: z.string().optional(), seen: z.string() });
const schema = z.object({ v: z.literal(1), profiles: z.record(z.string(), z.record(z.string(), entry)) });
type State = z.infer<typeof schema>;
const configFile = (name: string) => path.join(os.homedir(), ".config", "devhub", name);
const stateFile = () => configFile("notifications.json");
const prefsFile = () => configFile("ui-prefs.json");
function readState(file: string): State {
  return schema.parse(safeReadJSON<unknown>(file, { v: 1, profiles: {} }));
}

export function applyNotificationState(items: Notification[], profile: string, file = stateFile()): Notification[] {
  const stored = readState(file).profiles[profile] ?? {};
  return items.map(item => ({ ...item, read: stored[item.id]?.read === item.version, dismissed: stored[item.id]?.dismissed === item.version }));
}

export async function updateNotificationState(profile: string, items: Notification[], ids: string[], action: "read" | "dismiss" | "restore", file = stateFile(), now = Date.now()): Promise<void> {
  await withMutex(file, async () => {
    const state = readState(file);
    const stored = new Map(Object.entries(state.profiles[profile] ?? {}));
    const selected = new Set(ids);
    for (const item of items) {
      const previous = stored.get(item.id);
      if (!previous && !selected.has(item.id)) continue;
      const next = { ...previous, seen: new Date(now).toISOString() };
      if (selected.has(item.id)) {
        if (action === "restore") delete next.dismissed;
        else next[action === "read" ? "read" : "dismissed"] = item.version;
      }
      stored.set(item.id, next);
    }
    const cutoff = now - 30 * 86_400_000;
    const bounded = [...stored].filter(([, value]) => Date.parse(value.seen) >= cutoff)
      .sort((a, b) => b[1].seen.localeCompare(a[1].seen)).slice(0, 500);
    state.profiles = { ...state.profiles, [profile]: Object.fromEntries(bounded) };
    await writeAtomic(file, JSON.stringify(state) + "\n");
  });
}

export function readNeedsYouOwnedReposOnly(file = prefsFile()): boolean {
  return safeReadJSON<{ needsYouOwnedReposOnly?: unknown } | null>(file, null)?.needsYouOwnedReposOnly === true;
}
export async function writeNeedsYouOwnedReposOnly(value: boolean, file = prefsFile()): Promise<void> {
  await withMutex(file, async () => {
    const current = safeReadJSON<Record<string, unknown> | null>(file, null);
    const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    await writeAtomic(file, JSON.stringify({ ...base, needsYouOwnedReposOnly: value }, null, 2) + "\n");
  });
}

export function filterOwnedNotifications(items: Notification[], owners: string[] | null): Notification[] {
  if (!owners) return items;
  const allowed = new Set(owners.map(owner => owner.toLowerCase()));
  return items.filter(item => !item.repo || !/^[\w.-]+\/[\w.-]+$/.test(item.repo) || allowed.has(item.repo.split("/")[0].toLowerCase()));
}
