/**
 * The event spine — append-only, newline-delimited, boring on purpose.
 *
 * DevHub already *computes* everything in here. Commits are read for the git
 * page, PR state for /prs, script exit codes for the run registry, session
 * failures for the OpenCode recap. All of it is rendered once and dropped on
 * the floor. This module is the floor.
 *
 * ## Why NDJSON and not SQLite
 *
 * `docs/architecture/memory.md` rejects databases for memory on the grounds
 * that files are inspectable and diffable, and that reasoning holds here more
 * than anywhere else: the spine is the one genuinely new source of truth this
 * feature introduces, so it must be the one thing a human can read with `tail`
 * and recover with `git checkout`. A binary db would make the most important
 * file in the system the least auditable.
 *
 * Appends are O(1), reads are a full scan, and a full scan of a year of
 * developer activity is a few megabytes. When that stops being true, the shape
 * is already right for a sharded reader.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eventsDir, eventsFile } from "./paths";
import { extractRefs, mergeDerivedRefs } from "./refs";
import type { EntityRef, RecallEvent, RecallEventKind } from "./types";
import { RECALL_EVENT_KINDS } from "./types";

export interface AppendEventInput {
  kind: RecallEventKind;
  title: string;
  body?: string;
  source: string;
  url?: string;
  ts?: string;
  refs?: EntityRef[];
  meta?: Record<string, string | number | boolean>;
  /** Supply to make a re-emit idempotent (same id ⇒ skipped). */
  id?: string;
}

function isEventKind(value: unknown): value is RecallEventKind {
  return typeof value === "string" && (RECALL_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Parse one line, returning null rather than throwing.
 *
 * A half-written final line is the normal state of an append-only log that was
 * interrupted, so a corrupt tail must degrade to "one lost event" and never to
 * "the log won't load".
 */
export function parseEventLine(line: string): RecallEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.ts !== "string") return null;
  if (typeof obj.title !== "string" || !isEventKind(obj.kind)) return null;

  return {
    id: obj.id,
    ts: obj.ts,
    kind: obj.kind,
    title: obj.title,
    body: typeof obj.body === "string" ? obj.body : undefined,
    source: typeof obj.source === "string" ? obj.source : "unknown",
    url: typeof obj.url === "string" ? obj.url : undefined,
    refs: Array.isArray(obj.refs) ? (obj.refs as EntityRef[]) : undefined,
    meta: obj.meta && typeof obj.meta === "object" ? (obj.meta as RecallEvent["meta"]) : undefined,
  };
}

/**
 * Append one event.
 *
 * `fs.appendFileSync` rather than the atomic read-modify-write used elsewhere
 * in the codebase: for an append-only log, read-modify-write is both slower and
 * *less* safe, because two concurrent writers each rewrite the whole file and
 * one silently loses the other's events. A bare `O_APPEND` write of a single
 * line under the pipe buffer size is atomic at the OS level, which is exactly
 * the guarantee this needs and the only one it needs.
 */
export function appendEvent(input: AppendEventInput): RecallEvent {
  const ts = input.ts ?? new Date().toISOString();
  const derived = extractRefs(`${input.title}\n${input.body ?? ""}`);
  const event: RecallEvent = {
    id: input.id ?? randomUUID(),
    ts,
    kind: input.kind,
    title: input.title.slice(0, 500),
    body: input.body?.slice(0, 20_000),
    source: input.source,
    url: input.url,
    refs: mergeDerivedRefs(input.refs ?? [], derived),
    meta: input.meta,
  };

  const file = eventsFile(new Date(ts));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

function collectEventIds(): Set<string> {
  const ids = new Set<string>();
  const dir = eventsDir();
  if (!fs.existsSync(dir)) return ids;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".ndjson")) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, name), "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const event = parseEventLine(line);
      if (event) ids.add(event.id);
    }
  }
  return ids;
}

/** Append many, skipping ids already present. Returns only what was written. */
export function appendEvents(inputs: readonly AppendEventInput[]): RecallEvent[] {
  if (inputs.length === 0) return [];
  const existing = collectEventIds();
  const written: RecallEvent[] = [];
  for (const input of inputs) {
    if (input.id && existing.has(input.id)) continue;
    written.push(appendEvent(input));
    if (input.id) existing.add(input.id);
  }
  return written;
}

export interface ReadEventsOptions {
  /** Newest-first cap. Default 500. */
  limit?: number;
  /** Only events at/after this ISO timestamp. */
  since?: string;
  kinds?: RecallEventKind[];
}

function eventTime(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

/** Every event, newest first by instant — not file order, not lexicographic ts. */
export function readEvents(options: ReadEventsOptions = {}): RecallEvent[] {
  const { limit = 500, since, kinds } = options;
  const dir = eventsDir();
  if (!fs.existsSync(dir)) return [];

  // Newest month first so `limit` can stop before opening older shards. Line
  // order inside a shard is not chronological (git backfill appends `git log`,
  // newest first), so each shard is fully parsed before we decide to stop.
  const shards = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ndjson"))
    .sort((a, b) => b.localeCompare(a));

  const kindFilter = kinds && kinds.length > 0 ? new Set(kinds) : null;
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const out: RecallEvent[] = [];

  for (const shard of shards) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, shard), "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const event = parseEventLine(line);
      if (!event) continue;
      if (Number.isFinite(sinceMs) && eventTime(event.ts) < sinceMs) continue;
      if (kindFilter && !kindFilter.has(event.kind)) continue;
      out.push(event);
    }
    if (out.length >= limit) break;
  }

  out.sort((a, b) => eventTime(b.ts) - eventTime(a.ts) || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}

/** Count without materialising. Used by the status panel. */
export function countEvents(): number {
  const dir = eventsDir();
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".ndjson")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), "utf-8");
      for (const line of raw.split("\n")) if (line.trim()) total += 1;
    } catch {
      // A shard we can't read contributes nothing rather than failing the count.
    }
  }
  return total;
}
