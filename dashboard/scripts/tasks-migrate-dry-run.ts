/**
 * Plan one or more task directories without writing to them, then import temp copies.
 *
 *   npm run tasks:migrate-dry-run -- \
 *     --label "machine A" --tasks <dir> [--runs <dir> ...] \
 *     --label "machine B" --tasks <dir> \
 *     --out <file>
 *
 * --tasks is repeatable. Two or more directories are also planned as a union.
 * --runs is repeatable and attaches to the preceding --tasks.
 * --label names the preceding --tasks, or the next --tasks when it comes first.
 * Paths are whatever you pass. Nothing here has a built-in directory.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { migrateDirectory, planTaskDirs, type MigrationReport, type PlannedMigration } from "../../shared/tasks/migrate.ts";
import { readItems } from "../../shared/tasks/store.ts";
import { isTaskOpen } from "../../shared/tasks/types.ts";

const USAGE = `Usage: tasks-migrate-dry-run --tasks <dir> [--runs <dir>] [--label <name>] --out <file>
  --tasks and --runs and --label are repeatable. --runs attaches to the preceding --tasks.`;

interface Source {
  label: string;
  tasks: string;
  runs: string[];
  defaultLabel: boolean;
}

function parseArgs(argv: string[]): { sources: Source[]; out: string } {
  const sources: Source[] = [];
  let out = "";
  let queuedLabel: string | undefined;
  const take = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--tasks") {
      sources.push({
        label: queuedLabel ?? `copy ${sources.length + 1}`,
        tasks: path.resolve(take(arg, i)),
        runs: [],
        defaultLabel: queuedLabel === undefined,
      });
      queuedLabel = undefined;
      i += 1;
    } else if (arg === "--runs") {
      const current = sources[sources.length - 1];
      if (!current) throw new Error(`--runs must follow --tasks\n${USAGE}`);
      current.runs.push(path.resolve(take(arg, i)));
      i += 1;
    } else if (arg === "--label") {
      const label = take(arg, i);
      i += 1;
      const current = sources[sources.length - 1];
      if (current?.defaultLabel) {
        current.label = label;
        current.defaultLabel = false;
      } else queuedLabel = label;
    } else if (arg === "--out") {
      out = path.resolve(take(arg, i));
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (queuedLabel) throw new Error(`--label was not followed by --tasks\n${USAGE}`);
  if (sources.length === 0 || !out) throw new Error(USAGE);
  return { sources, out };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

function requireDir(dir: string): void {
  if (!fs.existsSync(dir)) throw new Error(`Missing dry-run directory: ${dir}`);
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}(?:\.local)?\.json$/;

function countDayFiles(dir: string): number {
  let count = 0;
  const walk = (folder: string): void => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "legacy" || entry.name === "conflicts") walk(path.join(folder, entry.name));
        continue;
      }
      if (DAY_FILE.test(entry.name)) count += 1;
    }
  };
  walk(dir);
  return count;
}

function countRootDayFiles(dir: string): number {
  return fs.readdirSync(dir).filter((name) => DAY_FILE.test(name)).length;
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (!fs.statSync(file).isFile()) continue;
    out.set(name, createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  }
  return out;
}

function sameSnapshot(a: Map<string, string>, b: Map<string, string>): string | null {
  if (a.size !== b.size) return `file count ${a.size} vs ${b.size}`;
  for (const [name, hash] of a) {
    if (b.get(name) !== hash) return name;
  }
  return null;
}

function renderPlan(title: string, dirs: string[], planned: PlannedMigration, ms: number, openList: boolean): string {
  const report: MigrationReport = planned.report;
  const onDisk = dirs.reduce((sum, dir) => sum + countDayFiles(dir), 0);
  const lines = [
    `## ${title}`,
    "",
    `Planned in ${ms.toFixed(0)}ms. Read-only. Sources: ${dirs.join(", ")}`,
    "",
    `- legacy files with rows: ${report.legacyFiles}`,
    `- day files on disk: ${onDisk}`,
    `- legacy rows: ${report.legacyRows}`,
    `- chains: ${report.chains}`,
    `- collapsed chains: ${report.collapsed}`,
    `- items: ${report.items} (open ${report.open}, done ${report.done}, abandoned ${report.abandoned}, ended-by-move ${report.endedByMove})`,
    `- conflicts resolved: ${report.conflicts.length}`,
    `- unreadable files: ${report.unreadable.length}`,
    `- ambiguous text matches left unlinked: ${report.ambiguous}`,
    `- duplicate rows folded (same date + id from another copy): ${report.duplicateRows}`,
    `- kept deleted: ${report.keptDeleted}`,
    `- dropped: ${report.dropped}`,
    "",
  ];
  if (report.dropped !== 0) lines.push("**dropped is not 0. Every legacy row must map to exactly one item.**", "");
  if (report.unreadable.length > 0) {
    lines.push("Unreadable:");
    for (const file of report.unreadable) lines.push(`- ${file}`);
    lines.push("");
  }
  if (report.problems.length > 0) {
    lines.push("Problems:");
    for (const problem of report.problems.slice(0, 20)) lines.push(`- ${problem}`);
    if (report.problems.length > 20) lines.push(`- … ${report.problems.length - 20} more`);
    lines.push("");
  }
  if (report.conflicts.length > 0) {
    lines.push("Conflicts:");
    for (const conflict of report.conflicts.slice(0, 20)) lines.push(`- ${clip(conflict.text)} — ${conflict.detail}`);
    if (report.conflicts.length > 20) lines.push(`- … ${report.conflicts.length - 20} more`);
    lines.push("");
  }
  lines.push("Sample collapsed chains (longest first):", "");
  for (const sample of report.samples) {
    const end = sample.endDate ?? "open";
    lines.push(`- ${clip(sample.text)} | ${sample.startDate} → ${end} | days ${sample.days.length} | legacy ids ${sample.legacyIds.length}`);
  }
  lines.push("");
  const moved = planned.items.filter((task) => task.endReason === "legacy-moved").sort((a, b) => a.startDate.localeCompare(b.startDate) || a.text.localeCompare(b.text));
  if (moved.length > 0) {
    lines.push(`Ended-by-move items (${moved.length}, all of them):`, "");
    for (const task of moved) lines.push(`- ${clip(task.text)} | ${task.startDate} → ${task.endDate ?? ""} | legacy ids ${task.legacyIds?.length ?? 1}`);
    lines.push("");
  }
  if (openList) {
    const open = planned.items
      .filter((task) => isTaskOpen(task))
      .sort((a, b) => a.rank.localeCompare(b.rank) || a.text.localeCompare(b.text));
    lines.push(`Open tasks (${open.length}):`, "");
    for (const task of open) lines.push(`- ${task.startDate} | ${clip(task.text)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function makeWritable(dir: string): void {
  fs.chmodSync(dir, 0o755);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) makeWritable(file);
    else fs.chmodSync(file, 0o644);
  }
}

function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true });
  makeWritable(dest);
}

interface RunRecord {
  runId?: string;
  updatedAt?: string;
}

/** runId -> newest record across every run file in the dir. */
function runRecords(dir: string): Map<string, RunRecord> {
  const out = new Map<string, RunRecord>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith("_index")) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { runs?: RunRecord[] };
    for (const run of parsed.runs ?? []) {
      const previous = out.get(String(run.runId));
      if (!previous || String(run.updatedAt) > String(previous.updatedAt)) out.set(String(run.runId), run);
    }
  }
  return out;
}

function runFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith("_index")).sort() : [];
}

function checkRuns(label: string, before: Map<string, RunRecord>, filesBefore: string[], dir: string): string {
  const after = runRecords(dir);
  const lost = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...before].filter(([id, record]) => after.has(id) && canonical(after.get(id)) !== canonical(record)).map(([id]) => id);
  const filesAfter = runFiles(dir);
  const indexPath = path.join(dir, "_index.json");
  const index = fs.existsSync(indexPath)
    ? (JSON.parse(fs.readFileSync(indexPath, "utf8")) as { byRunId: Record<string, string> })
    : { byRunId: {} };
  const dangling = Object.entries(index.byRunId).filter(([, taskId]) => !fs.existsSync(path.join(dir, `${taskId}.json`))).length;
  const verdict = lost.length === 0 && changed.length === 0 && dangling === 0 ? "none lost" : `LOST ${lost.length}, CHANGED ${changed.length}, DANGLING ${dangling}`;
  return `- ${label}: run files ${filesBefore.length} → ${filesAfter.length}, runs ${before.size} → ${after.size}, index entries ${Object.keys(index.byRunId).length}, local index left ${fs.existsSync(path.join(dir, "_index.local.json")) ? "yes" : "no"}: **${verdict}**`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotTaskState(tasksDir: string): Map<string, string> {
  const migrationKeys = new Set(["legacyThrough", "legacyIds", "legacyDigest", "legacyRowDigests"]);
  return new Map(readItems(tasksDir).map((task) => [
    `${task.id}.json`,
    canonical(Object.fromEntries(Object.entries(task).filter(([key]) => !migrationKeys.has(key)))),
  ]));
}

function diffSnapshots(a: Map<string, string>, b: Map<string, string>): { added: string[]; removed: string[]; changed: string[] } {
  return {
    added: [...b.keys()].filter((name) => !a.has(name)),
    removed: [...a.keys()].filter((name) => !b.has(name)),
    changed: [...a].filter(([name, hash]) => b.has(name) && b.get(name) !== hash).map(([name]) => name),
  };
}

function copyDayFiles(src: string, dest: string, name: (file: string) => string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (!DAY_FILE.test(file)) continue;
    fs.copyFileSync(path.join(src, file), path.join(dest, name(file)));
  }
}

function newDirWithRuns(root: string, label: string, tasksFrom: string, runsFrom: string[]): { tasks: string; runs: string; hasRuns: boolean } {
  const tasks = path.join(root, label, "tasks");
  const runs = path.join(root, label, "runs");
  copyTree(tasksFrom, tasks);
  fs.mkdirSync(runs, { recursive: true });
  for (const source of runsFrom) {
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, runs, { recursive: true });
  }
  makeWritable(runs);
  return { tasks, runs, hasRuns: runsFrom.length > 0 };
}

function runsOf(source: Source, fallback: string[]): string[] {
  return source.runs.length > 0 ? source.runs : fallback;
}

async function proveRealImports(sources: Source[]): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tasks-dry-"));
  process.env.DEVHUB_TASK_MIGRATION_DIR = path.join(root, "migration-state");
  const firstSource = sources[0]!;
  const lines = [
    "## Real imports on temp copies",
    "",
    `Temp dir: \`${root}\`. The directories you passed were copied, never written.`,
    "",
  ];
  let failed = false;
  const fail = (message: string): void => {
    failed = true;
    lines.push(`**FAILED: ${message}**`, "");
  };

  const primary = newDirWithRuns(root, "primary", firstSource.tasks, firstSource.runs);
  const runsBefore = runRecords(primary.runs);
  const runFilesBefore = runFiles(primary.runs);
  const started = performance.now();
  const first = await migrateDirectory(primary.tasks, primary.hasRuns ? { runsDir: primary.runs } : {});
  const firstMs = performance.now() - started;
  const afterFirst = snapshot(path.join(primary.tasks, "items"));
  const wholeFirst = snapshot(primary.tasks);
  const secondStarted = performance.now();
  const second = await migrateDirectory(primary.tasks, primary.hasRuns ? { runsDir: primary.runs } : {});
  const secondMs = performance.now() - secondStarted;
  const drift = sameSnapshot(afterFirst, snapshot(path.join(primary.tasks, "items")));
  const wholeDrift = sameSnapshot(wholeFirst, snapshot(primary.tasks));
  const runBytesFirst = snapshot(primary.runs);
  lines.push(
    `### ${firstSource.label}, twice`,
    "",
    `- first import: ${firstMs.toFixed(0)}ms, items ${first.items} (open ${first.open}, done ${first.done}, abandoned ${first.abandoned}, ended-by-move ${first.endedByMove}), dropped ${first.dropped}, unreadable ${first.unreadable.length}`,
    `- second import: ${secondMs.toFixed(0)}ms, skipped ${second.skipped}, item bytes ${drift === null ? "identical" : `CHANGED (${drift})`}, whole tasks dir ${wholeDrift === null ? "identical" : `CHANGED (${wholeDrift})`}`,
    `- legacy day files left at the root: ${countRootDayFiles(primary.tasks)}; under legacy/: ${countDayFiles(path.join(primary.tasks, "legacy"))}`,
    "",
  );
  if (first.dropped !== 0 || drift !== null || !second.skipped) fail(`${firstSource.label} import is not idempotent`);

  const secondSource = sources[1];
  if (secondSource) {
    const other = newDirWithRuns(root, "second", secondSource.tasks, runsOf(secondSource, firstSource.runs));
    const otherReport = await migrateDirectory(other.tasks, other.hasRuns ? { runsDir: other.runs } : {});
    const mismatch = sameSnapshot(afterFirst, snapshot(path.join(other.tasks, "items")));
    const runMismatch = other.hasRuns && primary.hasRuns ? sameSnapshot(runBytesFirst, snapshot(other.runs)) : null;
    lines.push(
      "### Two independent copies",
      "",
      `- ${secondSource.label}: items ${otherReport.items}, dropped ${otherReport.dropped}, item bytes ${mismatch === null ? `identical to ${firstSource.label}` : `DIFFER (${mismatch})`}`,
      `- run-history dir bytes ${!other.hasRuns || !primary.hasRuns ? "not compared" : runMismatch === null ? "identical on both" : `DIFFER (${runMismatch})`}`,
      "",
    );

    const meet = newDirWithRuns(root, "union", firstSource.tasks, firstSource.runs);
    copyDayFiles(secondSource.tasks, path.join(meet.tasks, "legacy"), (file) => file);
    const meetReport = await migrateDirectory(meet.tasks, meet.hasRuns ? { runsDir: meet.runs } : {});
    const meetMismatch = sameSnapshot(afterFirst, snapshot(path.join(meet.tasks, "items")));
    lines.push(
      `### ${firstSource.label} + ${secondSource.label} in one directory (root + legacy/)`,
      "",
      `- items ${meetReport.items}, duplicate rows folded ${meetReport.duplicateRows}, ambiguous ${meetReport.ambiguous}, ended-by-move ${meetReport.endedByMove}, dropped ${meetReport.dropped}, item bytes ${meetMismatch === null ? `identical to the ${firstSource.label} import` : `DIFFER (${meetMismatch})`}`,
      "",
    );
    if (meetReport.dropped !== 0) fail("duplicate copies dropped a row");
  }

  const thirdSource = sources[2];
  let staleRunsLine = "";
  if (secondSource && thirdSource) {
    const staleRuns = [...firstSource.runs, ...thirdSource.runs];
    const stale = newDirWithRuns(root, "stale", firstSource.tasks, staleRuns);
    const staleRunsBefore = runRecords(stale.runs);
    const staleFilesBefore = runFiles(stale.runs);
    copyDayFiles(secondSource.tasks, path.join(stale.tasks, "legacy"), (file) => file);
    copyDayFiles(thirdSource.tasks, path.join(stale.tasks, "legacy", "conflicts"), (file) => `${createHash("sha256").update(file).digest("hex").slice(0, 12)}-${file}`);
    const staleReport = await migrateDirectory(stale.tasks, stale.hasRuns ? { runsDir: stale.runs } : {});
    const primaryItems = readItems(primary.tasks);
    const staleItems = new Map(readItems(stale.tasks).map((task) => [task.id, task]));
    const reopened = primaryItems.filter((task) => {
      const next = staleItems.get(task.id);
      return !next || next.done !== task.done || next.endDate !== task.endDate || next.startDate !== task.startDate;
    });
    lines.push(
      `### ${firstSource.label} + ${secondSource.label} + ${thirdSource.label} (third copy as legacy/conflicts)`,
      "",
      `- items ${staleReport.items}, conflicts resolved ${staleReport.conflicts.length}, ambiguous ${staleReport.ambiguous}, dropped ${staleReport.dropped}`,
      `- items whose done state, endDate or startDate differs from the ${firstSource.label} import: ${reopened.length}`,
      "",
    );
    if (staleReport.dropped !== 0) fail("stale copy dropped a row");
    if (stale.hasRuns) staleRunsLine = checkRuns(`${firstSource.label} + ${thirdSource.label} runs`, staleRunsBefore, staleFilesBefore, stale.runs);
  }

  if (primary.hasRuns) {
    const primaryLine = checkRuns(`${firstSource.label} runs`, runsBefore, runFilesBefore, primary.runs);
    lines.push("### Run history (task-agent-runs)", "", primaryLine);
    if (staleRunsLine) lines.push(staleRunsLine);
    lines.push("");
    if (!primaryLine.endsWith("none lost**") || (staleRunsLine && !staleRunsLine.endsWith("none lost**"))) fail("a run record was lost");
  }

  const items = readItems(primary.tasks);
  const openItems = items.filter((task) => isTaskOpen(task)).sort((a, b) => a.id.localeCompare(b.id));
  const newest = items.reduce((max, task) => (task.legacyThrough && task.legacyThrough > max ? task.legacyThrough : max), "");
  if (openItems.length >= 2 && newest) {
    const nextDay = new Date(`${newest}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const lateDate = nextDay.toISOString().slice(0, 10);
    const beforeLate = snapshot(path.join(primary.tasks, "items"));
    const continued = openItems[0]!;
    const closed = openItems[1]!;
    const late = [
      { id: "late-brand-new", text: "Written on the old machine", done: false, createdAt: `${lateDate}T09:00:00.000Z` },
      { id: continued.id, text: `${continued.text} (edited on the old machine)`, done: false, createdAt: continued.createdAt },
      { id: closed.id, text: closed.text, done: true, completedAt: `${lateDate}T10:00:00.000Z`, createdAt: closed.createdAt },
    ];
    fs.writeFileSync(path.join(primary.tasks, `${lateDate}.json`), `${JSON.stringify(late, null, 2)}\n`);
    const lateReport = await migrateDirectory(primary.tasks, primary.hasRuns ? { runsDir: primary.runs } : {});
    const afterLate = snapshot(path.join(primary.tasks, "items"));
    const delta = diffSnapshots(beforeLate, afterLate);
    const expected = new Set(["late-brand-new.json", `${continued.id}.json`, `${closed.id}.json`]);
    const unexpected = [...delta.added, ...delta.changed, ...delta.removed].filter((name) => !expected.has(name));
    const closedAfter = readItems(primary.tasks).find((task) => task.id === closed.id);
    lines.push(
      `### Late legacy file ${lateDate}.json from an old-version machine`,
      "",
      "Contents: one new task, one existing open task edited, one existing open task done on the old machine.",
      "",
      `- items ${lateReport.items}, dropped ${lateReport.dropped}`,
      `- item files added ${delta.added.length}, changed ${delta.changed.length}, removed ${delta.removed.length}; touched outside those three tasks: ${unexpected.length}`,
      `- new task: ${delta.added.includes("late-brand-new.json") ? "landed" : "MISSING"}; edited task text: ${readItems(primary.tasks).find((task) => task.id === continued.id)?.text.endsWith("(edited on the old machine)") ? "landed" : "MISSING"}; done-on-old-machine: ${closedAfter?.done === true && closedAfter.endDate === lateDate ? `landed (endDate ${closedAfter.endDate})` : "MISSING"}`,
      "",
    );
    if (unexpected.length > 0 || lateReport.dropped !== 0 || !delta.added.includes("late-brand-new.json") || closedAfter?.done !== true) fail("late legacy file did not land cleanly");

    const finished = readItems(primary.tasks).find((task) => task.done && task.endDate && task.endDate < newest);
    if (finished) {
      const beforeStale = snapshot(path.join(primary.tasks, "items"));
      // Rejected versions must be remembered, or they can replay after a later reactivation.
      const stateBeforeStale = snapshotTaskState(primary.tasks);
      const staleDate = finished.startDate;
      fs.writeFileSync(path.join(primary.tasks, `${staleDate}.json`), `${JSON.stringify([{ id: finished.id, text: finished.text, done: false, createdAt: finished.createdAt }], null, 2)}\n`);
      const staleLate = await migrateDirectory(primary.tasks, primary.hasRuns ? { runsDir: primary.runs } : {});
      const stillDone = readItems(primary.tasks).find((task) => task.id === finished.id)?.done === true;
      const noChange = sameSnapshot(beforeStale, snapshot(path.join(primary.tasks, "items")));
      const stateChange = sameSnapshot(stateBeforeStale, snapshotTaskState(primary.tasks));
      lines.push(
        `### Stale ${staleDate}.json (an old-version machine's copy) re-opening a finished task`,
        "",
        `- "${clip(finished.text)}" stays done: ${stillDone ? "yes" : "NO"}; item state ${stateChange === null ? "unchanged" : `CHANGED (${stateChange})`}; item bytes ${noChange === null ? "unchanged" : stateChange === null ? "changed (migration ledger only)" : `CHANGED (${noChange})`}; dropped ${staleLate.dropped}`,
        "",
      );
      if (!stillDone || stateChange !== null || staleLate.dropped !== 0) fail("a stale overlay changed task state");
    }
  }
  lines.push(failed ? "Determinism check failed." : "All real-import checks passed.", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { sources, out } = parseArgs(process.argv.slice(2));
  for (const source of sources) {
    requireDir(source.tasks);
    for (const runs of source.runs) requireDir(runs);
  }
  const scenarios: Array<{ title: string; dirs: string[] }> = sources.map((source) => ({ title: source.label, dirs: [source.tasks] }));
  if (sources.length > 1) {
    scenarios.push({ title: sources.map((source) => source.label).join(" + "), dirs: sources.map((source) => source.tasks) });
  }
  const parts = [
    "# Task migration dry run",
    "",
    "Generated " + new Date().toISOString() + ". Plans call `planTaskDirs` and do not write. The real imports below use temp copies.",
    "",
  ];
  let failed = false;
  let baseline: Map<string, string> | null = null;
  const projection = (task: PlannedMigration["items"][number]): string =>
    JSON.stringify([task.id, task.text, task.done, task.startDate, task.endDate, task.endReason, task.completedAt, task.abandonedAt]);
  const firstLabel = sources[0]!.label;
  for (const scenario of scenarios) {
    const started = performance.now();
    const planned = planTaskDirs(scenario.dirs);
    const ms = performance.now() - started;
    let rendered = renderPlan(scenario.title, scenario.dirs, planned, ms, true);
    const current = new Map(planned.items.map((task) => [task.id, projection(task)]));
    if (!baseline) baseline = current;
    else {
      const differing = [...baseline].filter(([id, value]) => current.get(id) !== value).length + [...current.keys()].filter((id) => !baseline!.has(id)).length;
      rendered = rendered.replace("\n- items:", `\n- vs ${firstLabel} plan (id, text, state, start/end dates): ${differing === 0 ? "identical" : `${differing} DIFFER`}\n- items:`);
    }
    parts.push(rendered);
    if (planned.report.dropped !== 0) failed = true;
  }
  parts.push(await proveRealImports(sources));
  if (parts[parts.length - 1].includes("Determinism check failed.")) failed = true;
  const markdown = parts.join("\n") + "\n";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, markdown);
  process.stdout.write(markdown);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
