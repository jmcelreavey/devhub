/**
 * "I've seen this" for radar surfaces — capability drift today, dependency
 * releases next.
 *
 * ## The problem this fixes
 *
 * `/radar` computed its diff as *latest snapshot vs previous snapshot*, every
 * time, with no memory of what you had already looked at. So a signal that
 * spread three months ago kept appearing until a later snapshot happened to
 * stop mentioning it. There was no acknowledgement concept at all — which is
 * worse than a broken one, because the page looked like it had a "seen" notion
 * and didn't. The list only ever grew, so it stopped being read, which is the
 * failure mode for every notification surface.
 *
 * ## Acknowledgement is a watermark, not a delete
 *
 * The obvious implementation is a set of dismissed ids. It's wrong, and wrong
 * in a way that matters: "Kubernetes is in 3 of your repos" and "Kubernetes is
 * in 11 of your repos" are different facts. Dismissing the first should not
 * silence the second — the second is exactly the drift the page exists to
 * surface.
 *
 * So an acknowledgement records the *magnitude* at the time you saw it. The
 * item stays hidden while it sits at or below that level and comes back when it
 * grows past it, carrying the comparison with it. Nothing is ever permanently
 * suppressed, so there is no state where the page is quietly lying to you.
 *
 * ## Why `notes/.radar/` specifically
 *
 * Three constraints, and only this path satisfies all of them.
 *
 * **Not `notes/.cache/`.** Everything else the Capability Radar writes is
 * derived and rebuilds on demand. An acknowledgement is the one piece of
 * genuine user intent here and cannot be recomputed, so a cache clear must not
 * discard it and flood the page again.
 *
 * **Under `notes/`,** so it syncs across machines with everything else —
 * acknowledging on the laptop shouldn't leave it unread on the desktop.
 *
 * **Dot-directory, not `notes/radar/`.** The first version used `notes/radar/`,
 * which is wrong twice over. That directory already holds `personal-radar.md`,
 * a file the user owns — and more importantly `notes/` is a *browsable vault*:
 * `note-index.ts` and `search.ts` both index `.json`, so a machine-state file
 * sitting there would surface in the notes tree and in search results as a note
 * called "acknowledgements". Both walkers skip names beginning with `.`, which
 * is exactly the property needed.
 */
import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { writeAtomicNow } from "@/lib/atomic-write";
import { isCaughtUp } from "@/lib/catch-up";

/** Namespaces so capability signals and release advisories can't collide. */
export type AckKind = "capability" | "release";

export interface Acknowledgement {
  /** When it was acknowledged. Shown as "you saw this N days ago". */
  ackedAt: string;
  /**
   * Magnitude at acknowledgement time — repo count for capability drift, the
   * count of pending advisories for a dependency. The item re-surfaces once the
   * current magnitude exceeds this.
   */
  watermark: number;
}

export type AckStore = Record<string, Acknowledgement>;

export function acknowledgementsPath(): string {
  return path.join(getNotesDir(), ".radar", "acknowledgements.json");
}

function storeKey(kind: AckKind, id: string): string {
  return `${kind}:${id}`;
}

export function readAcknowledgements(): AckStore {
  try {
    const file = acknowledgementsPath();
    if (!fs.existsSync(file)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    // Drop anything malformed rather than letting a hand-edited or
    // partially-written file suppress items with a NaN watermark, which would
    // hide them forever with no way to notice.
    const clean: AckStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<Acknowledgement>;
      if (typeof entry.ackedAt !== "string") continue;
      if (typeof entry.watermark !== "number" || !Number.isFinite(entry.watermark)) continue;
      clean[key] = { ackedAt: entry.ackedAt, watermark: entry.watermark };
    }
    return clean;
  } catch {
    return {};
  }
}

function writeAcknowledgements(store: AckStore): void {
  const file = acknowledgementsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomicNow(file, `${JSON.stringify(store, null, 2)}\n`);
}

export function acknowledge(kind: AckKind, id: string, watermark: number): AckStore {
  const store = readAcknowledgements();
  store[storeKey(kind, id)] = {
    ackedAt: new Date().toISOString(),
    // A negative or non-finite watermark would make `current > watermark`
    // trivially true or never true; clamp rather than trust the caller.
    watermark: Number.isFinite(watermark) ? Math.max(0, Math.trunc(watermark)) : 0,
  };
  writeAcknowledgements(store);
  return store;
}

export function unacknowledge(kind: AckKind, id: string): AckStore {
  const store = readAcknowledgements();
  delete store[storeKey(kind, id)];
  writeAcknowledgements(store);
  return store;
}

export function acknowledgementFor(
  store: AckStore,
  kind: AckKind,
  id: string,
): Acknowledgement | null {
  return store[storeKey(kind, id)] ?? null;
}

/**
 * Whether an item should be hidden right now.
 *
 * Hidden only while it has not grown past where it was acknowledged. Equal
 * counts as unchanged — re-showing something because a rescan found the same
 * thing again is the noise this is meant to remove.
 */
export function isSuppressed(
  store: AckStore,
  kind: AckKind,
  id: string,
  currentWatermark: number,
): boolean {
  const ack = acknowledgementFor(store, kind, id);
  if (!ack) return false;
  return isCaughtUp(currentWatermark, ack.watermark);
}

export interface Partitioned<T> {
  /** Not acknowledged, or grown since it was. */
  visible: T[];
  /** Acknowledged and unchanged — available behind a toggle, never deleted. */
  acknowledged: Array<T & { acknowledgedAt: string; acknowledgedAt_watermark: number }>;
}

/**
 * Split a list into what still needs attention and what has been dealt with.
 *
 * Returned rather than filtered in place so the UI can offer "show
 * acknowledged" — a surface that can hide things without being able to show
 * them again teaches people not to use the hide button.
 */
export function partitionByAcknowledgement<T>(
  items: T[],
  kind: AckKind,
  getId: (item: T) => string,
  getWatermark: (item: T) => number,
  store: AckStore = readAcknowledgements(),
): Partitioned<T> {
  const visible: T[] = [];
  const acknowledged: Partitioned<T>["acknowledged"] = [];

  for (const item of items) {
    const id = getId(item);
    const current = getWatermark(item);
    const ack = acknowledgementFor(store, kind, id);
    if (ack && isCaughtUp(current, ack.watermark)) {
      acknowledged.push({
        ...item,
        acknowledgedAt: ack.ackedAt,
        acknowledgedAt_watermark: ack.watermark,
      });
    } else {
      visible.push(item);
    }
  }

  return { visible, acknowledged };
}

/**
 * Forget acknowledgements for ids that no longer exist.
 *
 * Without this the file grows forever with signals detached from anything real,
 * and a signal that disappears and later returns stays silently suppressed at a
 * watermark nobody remembers setting.
 */
export function pruneAcknowledgements(kind: AckKind, liveIds: Iterable<string>): AckStore {
  const live = new Set(liveIds);
  const store = readAcknowledgements();
  let changed = false;

  for (const key of Object.keys(store)) {
    if (!key.startsWith(`${kind}:`)) continue;
    if (!live.has(key.slice(kind.length + 1))) {
      delete store[key];
      changed = true;
    }
  }

  if (changed) writeAcknowledgements(store);
  return store;
}
