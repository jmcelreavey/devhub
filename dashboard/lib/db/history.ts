/**
 * What you ran, and when.
 *
 * "What was that query I ran against prd last Tuesday" is a real question with
 * no good answer today — it lives in a terminal scrollback that is gone. A flat
 * JSON file in the app data dir, capped, matching how the rest of DevHub
 * persists things (notes, tasks, the recall index are all files).
 *
 * Statements are stored as written, because a truncated query is not much use
 * to re-run. They are *summarised* before anything renders them elsewhere.
 */

import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "@/lib/desktop/runtime-paths";
import { summarizeStatement } from "./query-registry";
import type { DbStatementKind } from "./statement-kind";

export interface DbHistoryEntry {
  id: string;
  connectionId: string;
  /** Label at the time it ran — a connection can be renamed or disappear. */
  connectionLabel: string;
  statement: string;
  kind: DbStatementKind;
  at: number;
  durationMs: number;
  ok: boolean;
  rowCount?: number;
  error?: string;
}

/**
 * Enough to answer "what did I run this week" without the file becoming
 * something that needs its own index.
 */
const HISTORY_CAP = 500;

export function historyPath(appDataDir: string = getAppDataDir()): string {
  return path.join(appDataDir, "db-history.json");
}

export function readDbHistory(file = historyPath()): DbHistoryEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { entries?: DbHistoryEntry[] };
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    // Missing on a fresh install; malformed is the user's own file. Neither is
    // worth failing a query over — history is a convenience, not a ledger.
    return [];
  }
}

function writeDbHistory(entries: DbHistoryEntry[], file = historyPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
}

export function recordDbHistory(
  entry: Omit<DbHistoryEntry, "id" | "at">,
  file = historyPath(),
): DbHistoryEntry {
  const full: DbHistoryEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  const entries = [full, ...readDbHistory(file)].slice(0, HISTORY_CAP);
  try {
    writeDbHistory(entries, file);
  } catch {
    // A failed history write must never fail the query that produced it.
  }
  return full;
}

export interface DbHistoryQuery {
  connectionId?: string;
  /** Case-insensitive substring over the statement text. */
  search?: string;
  limit?: number;
}

export function queryDbHistory(opts: DbHistoryQuery = {}, file = historyPath()): DbHistoryEntry[] {
  const search = opts.search?.trim().toLowerCase();
  return readDbHistory(file)
    .filter((e) => !opts.connectionId || e.connectionId === opts.connectionId)
    .filter((e) => !search || e.statement.toLowerCase().includes(search))
    .slice(0, opts.limit ?? 50);
}

/** History rendered for a list — statements summarised, never raw. */
export function historyForDisplay(entries: DbHistoryEntry[]) {
  return entries.map((e) => ({ ...e, statement: summarizeStatement(e.statement, 200) }));
}

export function clearDbHistory(file = historyPath()): void {
  try {
    writeDbHistory([], file);
  } catch {
    // Same reasoning as above.
  }
}
