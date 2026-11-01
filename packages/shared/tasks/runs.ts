import fs from "node:fs";
import path from "node:path";
import { isTaskId } from "./paths.ts";

interface RunFile {
  version: number;
  taskId: string;
  handoff: string;
  handoffUpdatedAt?: string;
  runs: Array<Record<string, unknown> & { runId?: string; updatedAt?: string }>;
}

interface RunIndex {
  version: number;
  byRunId: Record<string, string>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function emptyFile(taskId: string): RunFile {
  return { version: 1, taskId, handoff: "", runs: [] };
}

type LooseRunFile = RunFile & { rest: Record<string, unknown> };

/** Null when the file is missing or unreadable: callers must leave it in place. */
function readRunFile(file: string, taskId: string): LooseRunFile | null {
  const parsed = readJson<Record<string, unknown>>(file);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.runs)) return null;
  const { version: _v, taskId: _t, handoff, handoffUpdatedAt, runs, ...rest } = parsed;
  return {
    version: 1,
    taskId,
    handoff: typeof handoff === "string" ? handoff : "",
    ...(typeof handoffUpdatedAt === "string" ? { handoffUpdatedAt } : {}),
    runs: (runs as unknown[]).filter((run): run is RunFile["runs"][number] => !!run && typeof run === "object" && !Array.isArray(run)),
    rest,
  };
}

function mergeRuns(target: LooseRunFile, extra: LooseRunFile): LooseRunFile {
  const byId = new Map<string, RunFile["runs"][number]>();
  const anonymous = new Map<string, RunFile["runs"][number]>();
  for (const run of [...target.runs, ...extra.runs]) {
    const id = typeof run.runId === "string" ? run.runId : "";
    if (!id) {
      // A record without a runId cannot be matched, so keep every distinct one.
      anonymous.set(stableJson(run), run);
      continue;
    }
    const previous = byId.get(id);
    if (!previous) {
      byId.set(id, run);
      continue;
    }
    const prevAt = typeof previous.updatedAt === "string" ? previous.updatedAt : "";
    const nextAt = typeof run.updatedAt === "string" ? run.updatedAt : "";
    if (nextAt > prevAt || (nextAt === prevAt && stableJson(run) > stableJson(previous))) byId.set(id, run);
  }
  const handoffs = [target.handoff, extra.handoff].map((text) => text.trim()).filter(Boolean);
  const unique: string[] = [];
  for (const text of handoffs) {
    if (!unique.includes(text)) unique.push(text);
  }
  const handoffUpdatedAt = [target.handoffUpdatedAt, extra.handoffUpdatedAt].filter((value): value is string => !!value).sort().at(-1);
  return {
    version: 1,
    taskId: target.taskId,
    handoff: unique.join("\n\n"),
    ...(handoffUpdatedAt ? { handoffUpdatedAt } : {}),
    runs: [
      ...[...byId.values()].sort((a, b) => String(a.runId).localeCompare(String(b.runId))),
      ...[...anonymous.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, run]) => run),
    ],
    // First writer (lowest sorted id) wins for unknown top-level keys, so every machine agrees.
    rest: { ...extra.rest, ...target.rest },
  };
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export interface RelinkResult {
  /** Legacy run files folded into a survivor and removed. */
  merged: string[];
  /** Run files left exactly where they were because they could not be parsed. */
  unreadable: string[];
  /** Index entries repointed at a survivor id. */
  reindexed: number;
}

/**
 * Point every legacy id's run file and index entry at the surviving task id.
 * A run is never dropped: the survivor file is written (atomically) before any
 * source file is removed, unreadable files stay in place, and runs without a
 * runId are kept. Output is deterministic for the same inputs and a second call
 * is a no-op. Ids that are already the survivor are left alone.
 */
export function relinkMigratedRuns(runsDir: string, chains: ReadonlyArray<{ id: string; legacyIds?: readonly string[] }>): RelinkResult {
  const result: RelinkResult = { merged: [], unreadable: [], reindexed: 0 };
  if (!fs.existsSync(runsDir)) return result;
  const indexPath = path.join(runsDir, "_index.json");
  const localIndexPath = path.join(runsDir, "_index.local.json");
  const index = readJson<RunIndex>(indexPath) ?? { version: 1, byRunId: {} };
  if (!index.byRunId || typeof index.byRunId !== "object") index.byRunId = {};
  const local = readJson<RunIndex>(localIndexPath);
  // Only `_index.json` is read by the app, so fold the local overlay into it (overlay wins, as before).
  let indexChanged = false;
  if (local?.byRunId && typeof local.byRunId === "object") {
    Object.assign(index.byRunId, local.byRunId);
    indexChanged = true;
  }

  const survivorOf = new Map<string, string>();
  for (const chain of chains) {
    if (!isTaskId(chain.id)) continue;
    for (const id of chain.legacyIds ?? []) {
      if (id !== chain.id && isTaskId(id)) survivorOf.set(id, chain.id);
    }
  }

  for (const chain of chains) {
    if (!isTaskId(chain.id)) continue;
    const ids = [...new Set([chain.id, ...(chain.legacyIds ?? [])])].filter((id) => isTaskId(id)).sort();
    const extras = ids.filter((id) => id !== chain.id && fs.existsSync(path.join(runsDir, `${id}.json`)));
    if (extras.length === 0) continue;
    const survivorFile = path.join(runsDir, `${chain.id}.json`);
    if (fs.existsSync(survivorFile) && readRunFile(survivorFile, chain.id) === null) {
      // Never overwrite a survivor we cannot read.
      result.unreadable.push(`${chain.id}.json`);
      continue;
    }
    let merged: LooseRunFile = { ...emptyFile(chain.id), rest: {} };
    const folded: string[] = [];
    for (const id of ids) {
      const file = path.join(runsDir, `${id}.json`);
      if (!fs.existsSync(file)) continue;
      const parsed = readRunFile(file, id);
      if (parsed === null) {
        result.unreadable.push(`${id}.json`);
        continue;
      }
      merged = mergeRuns(merged, parsed);
      if (id !== chain.id) folded.push(id);
    }
    const { rest, ...body } = merged;
    writeAtomic(survivorFile, stableJson({ ...rest, ...body, taskId: chain.id }));
    for (const id of folded) {
      fs.rmSync(path.join(runsDir, `${id}.json`));
      result.merged.push(`${id}.json`);
    }
  }

  for (const [runId, taskId] of Object.entries(index.byRunId)) {
    const survivor = survivorOf.get(taskId);
    if (!survivor) continue;
    index.byRunId[runId] = survivor;
    result.reindexed += 1;
    indexChanged = true;
  }
  if (indexChanged) {
    const byRunId: Record<string, string> = {};
    for (const key of Object.keys(index.byRunId).sort()) byRunId[key] = index.byRunId[key]!;
    writeAtomic(indexPath, stableJson({ version: 1, byRunId }));
    fs.rmSync(localIndexPath, { force: true });
  }
  return result;
}
