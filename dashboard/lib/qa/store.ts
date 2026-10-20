import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { QaReceipt } from "@devhub/qa";
import { getNotesDir } from "@/lib/notes/dir";
import { ScenarioSchema, SettingsSchema, type QaSettings, type SavedScenario } from "./schema";

export interface QaRunRecord {
  id: string;
  requestId: string;
  scenarioId: string;
  taskId?: string;
  /** Prevents a late result from attaching to the same task after Reset and Start. */
  orchestrationId?: string;
  createdAt: string;
  state: "running" | "finished";
  receipt?: QaReceipt;
  revision?: QaReceipt["revision"];
  /** Recorded at task start to supply the "before" video; never advances the orchestration. */
  baseline?: boolean;
  ownerPid?: number;
}
export function qaDir(notesDir = getNotesDir()): string { return path.join(notesDir, ".config", "qa"); }
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function readSettings(notesDir = getNotesDir()): QaSettings {
  return SettingsSchema.parse(readJson(path.join(qaDir(notesDir), "settings.json")) ?? {});
}
export function saveSettings(settings: QaSettings, notesDir = getNotesDir()): void {
  writeJson(path.join(qaDir(notesDir), "settings.json"), SettingsSchema.parse(settings));
}
export function listScenarios(notesDir = getNotesDir()): SavedScenario[] {
  const raw = readJson(path.join(qaDir(notesDir), "scenarios.json")) ?? [];
  return ScenarioSchema.array().parse(raw);
}
export function saveScenario(scenario: SavedScenario, notesDir = getNotesDir()): void {
  const validated = ScenarioSchema.parse(scenario);
  const scenarios = listScenarios(notesDir).filter(row => row.id !== validated.id);
  if (scenarios.length >= 100) throw new Error("QA scenario limit reached (100).");
  writeJson(path.join(qaDir(notesDir), "scenarios.json"), [...scenarios, validated]);
}
export function runDir(id: string, notesDir = getNotesDir()): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid QA run ID.");
  return path.join(qaDir(notesDir), "runs", id);
}
export function writeRun(run: QaRunRecord, notesDir = getNotesDir()): void {
  writeJson(path.join(runDir(run.id, notesDir), "receipt.json"), run);
}
export function readRun(id: string, notesDir = getNotesDir()): QaRunRecord | null {
  return readJson(path.join(runDir(id, notesDir), "receipt.json")) as QaRunRecord | null;
}
export function listRuns(notesDir = getNotesDir()): QaRunRecord[] {
  const dir = path.join(qaDir(notesDir), "runs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(id => /^[a-f0-9-]{36}$/.test(id)).map(id => readRun(id, notesDir))
    .filter((row): row is QaRunRecord => row !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function artifactPath(id: string, file: string, notesDir = getNotesDir()): string | null {
  const run = readRun(id, notesDir);
  if (!run?.receipt?.artifacts.some(artifact => artifact.file === file)) return null;
  if (path.basename(file) !== file) return null;
  const root = fs.realpathSync(runDir(id, notesDir));
  try {
    const target = fs.realpathSync(path.join(root, file));
    return path.dirname(target) === root ? target : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
