/**
 * Daily reps — deliberate practice built from the user's own repos, not from
 * work their job already forces (PR reviews are explicitly out of scope).
 *
 * A rep is generated server-side (see `reps-generate.ts`) from real material:
 * a commit they didn't write (cold read), an owned-repo knowledge gap (gap
 * sketch), or one of their own diagrams (recall). The answer is stored with
 * the rep but only returned to the client after the response is saved — no
 * peeking.
 *
 * This module owns storage and is server-only (it touches the filesystem);
 * client-safe types and helpers live in `reps-shared.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { getRepsDir } from "@/lib/content/dirs";
import type { GeneratedRep, Rep, RepDayPoint, RepStats } from "@/lib/reps-shared";

export * from "@/lib/reps-shared";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function repFile(date: string): string {
  return path.join(getRepsDir(), `${date}.json`);
}

export function readRep(date: string): Rep | null {
  if (!DATE_RE.test(date)) return null;
  const rep = safeReadJSON<Rep | null>(repFile(date), null);
  // Pre-refactor reps were PR reviews with a different shape; ignore them.
  return rep?.kind && rep.material ? rep : null;
}

async function writeRep(rep: Rep): Promise<void> {
  await fs.promises.mkdir(getRepsDir(), { recursive: true });
  await writeAtomic(repFile(rep.date), `${JSON.stringify(rep, null, 2)}\n`);
}

/** Start today's rep. Idempotent — once a day has one, it sticks. */
export async function startRep(date: string, generated: GeneratedRep): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const existing = readRep(date);
    if (existing) return existing;
    const rep: Rep = { date, attempt: 0, startedAt: new Date().toISOString(), ...generated };
    await writeRep(rep);
    return rep;
  });
}

/** Swap today's material. Only allowed before the response is saved. */
export async function swapRep(date: string, generated: GeneratedRep): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const rep = readRep(date);
    if (!rep) throw new Error("No rep started for today");
    if (rep.completedAt) throw new Error("Too late to swap — this rep is already completed");
    const swapped: Rep = {
      date,
      attempt: rep.attempt + 1,
      startedAt: new Date().toISOString(),
      ...generated,
    };
    await writeRep(swapped);
    return swapped;
  });
}

export async function saveRepResponse(date: string, response: string): Promise<Rep> {
  return withMutex(repFile(date), async () => {
    const rep = readRep(date);
    if (!rep) throw new Error("No rep started for today");
    rep.response = response;
    rep.completedAt = new Date().toISOString();
    await writeRep(rep);
    return rep;
  });
}

function shiftISO(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

/**
 * Consecutive completed days ending today (or yesterday when today isn't done
 * yet). Pre-refactor rep files count too — a completed day is a completed day.
 */
export function repStats(today: string): RepStats {
  const dir = getRepsDir();
  const completedDates = new Set<string>();
  let completedCount = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const date = file.slice(0, -".json".length);
      if (!DATE_RE.test(date)) continue;
      const rep = safeReadJSON<{ completedAt?: string } | null>(path.join(dir, file), null);
      if (!rep?.completedAt) continue;
      completedDates.add(date);
      completedCount += 1;
    }
  } catch {
    // No reps dir yet — everything stays zero.
  }

  let streak = 0;
  let cursor = today;
  if (!completedDates.has(cursor)) cursor = shiftISO(cursor, -1);
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = shiftISO(cursor, -1);
  }

  const recent: RepDayPoint[] = [];
  for (let i = 34; i >= 0; i--) {
    const date = shiftISO(today, -i);
    recent.push({ date, done: completedDates.has(date) });
  }

  return { streak, completedCount, recent };
}
