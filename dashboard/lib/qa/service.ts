import { createHash, randomUUID } from "node:crypto";
import { typesafeApiKey } from "./credentials";
import { jevPolicy, runQa, type QaReceipt } from "@devhub/qa";
import { BrowserDriver } from "@devhub/qa/browser";
import { getNotesDir } from "@/lib/notes/dir";
import { readOrchestration, mutateOrchestration, withOrchestrationMutationLock } from "@/lib/storyboard/orchestration-store";
import type { OrchestrationRecord } from "@/lib/storyboard/types";
import { StoryboardError } from "@/lib/storyboard/errors";
import type { Task } from "@/lib/tasks/types";
import { DesktopDriver } from "./desktop";
import { listRuns, listScenarios, readRun, readSettings, runDir, saveScenario, writeRun, type QaRunRecord } from "./store";
import { visionPolicy } from "./vision";
import { ScenarioSchema, StartSchema, type SavedScenario } from "./schema";
import { claimQaLease, processAlive } from "./lease";
import { interruptedReceipt } from "./interrupted-receipt";

const shared = globalThis as typeof globalThis & { __devhubQaJobs?: Map<string, AbortController> };
const jobs = shared.__devhubQaJobs ??= new Map<string, AbortController>();

const TARGET_LABEL = /\b(?:app|application|preview|demo|target)(?:\s+url)?\b/i;

export interface TaskQaInput {
  task: Pick<Task, "id" | "text" | "links">;
  noteMarkdown?: string | null;
  sourceRunId: string;
  /** Task-start capture of the app before the change, used as the card's "before" video. */
  baseline?: boolean;
  /** Where Jev points when the caller already resolved it (auto mode's preview, a dev server it started). Wins over the task and note. */
  targetUrl?: string;
}

export type TaskQaPreparation =
  | { skipped: true; reason: string }
  | { skipped: false; run: QaRunRecord; execute?: () => Promise<void> };

export function activeQaJobCount(): number {
  return jobs.size;
}

function httpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.replace(/[),.;]+$/, ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A link labelled "app" is often the repo or its PR; Jev can't test a GitHub page, and a 404 there reads as a QA failure. */
function appUrl(raw: string | undefined): string | null {
  const url = httpUrl(raw);
  return url && !/^(?:www\.)?(?:github|gitlab|bitbucket)\.(?:com|org)$/i.test(new URL(url).hostname) && !/(?:^|\.)atlassian\.net$/i.test(new URL(url).hostname) ? url : null;
}

function markdownSection(markdown: string, headings: readonly RegExp[]): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => headings.some((heading) => heading.test(line.trim())));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  return body || null;
}

function plainGoalText(markdown: string | null): string | null {
  if (!markdown) return null;
  const text = markdown
    .replace(/^\s*[-*+]\s*(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function taskQaTargetUrl(task: Pick<Task, "links">, noteMarkdown?: string | null): string | null {
  for (const link of task.links ?? []) {
    if (["repo", "pr", "jira"].includes(link.kind)) continue;
    if (!TARGET_LABEL.test(link.label) || !link.href) continue;
    const url = appUrl(link.href);
    if (url) return url;
  }
  const note = noteMarkdown ?? "";
  for (const match of note.matchAll(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/gi)) {
    if (!TARGET_LABEL.test(match[1] ?? "")) continue;
    const url = appUrl(match[2]);
    if (url) return url;
  }
  for (const match of note.matchAll(/\b(?:app|application|preview|demo|target)(?:\s+url)?\s*[:=-]\s*<?(https?:\/\/[^\s>]+)/gi)) {
    const url = appUrl(match[1]);
    if (url) return url;
  }
  const preview = markdownSection(note, [/^##\s+(?:App|Application|Preview|Demo|Target)\b/i]);
  for (const match of preview?.matchAll(/https?:\/\/[^\s>)]+/gi) ?? []) {
    const url = appUrl(match[0]);
    if (url) return url;
  }
  return null;
}

export function buildTaskQaScenario(input: Pick<TaskQaInput, "task" | "noteMarkdown" | "targetUrl">): SavedScenario | null {
  const url = (input.targetUrl ? httpUrl(input.targetUrl) : null) ?? taskQaTargetUrl(input.task, input.noteMarkdown);
  if (!url) return null;
  const title = plainGoalText(input.task.text)?.slice(0, 1000) || "Complete the task outcome";
  const markdown = input.noteMarkdown ?? "";
  const description = plainGoalText(markdownSection(markdown, [/^##\s+Description\b/i]));
  const acceptance = plainGoalText(markdownSection(markdown, [/^##\s+Acceptance(?:\s+criteria)?\b/i]));
  const sources = [["title", title], ["description", description], ["acceptance", acceptance]] as const;
  const goals = sources.flatMap(([id, source]) => source ? [{
    id,
    description: source.slice(0, 1000),
    assertion: "text" as const,
    selector: "body",
    expected: source.slice(0, 2000),
  }] : []);
  return ScenarioSchema.parse({
    id: `storyboard-${input.task.id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100),
    title: `Auto QA · ${title}`.slice(0, 200),
    surface: "dom",
    url,
    goals,
    context: [
      `Task title: ${title}`,
      description ? `Description: ${description}` : null,
      acceptance ? `Acceptance: ${acceptance}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n").slice(0, 4000),
  });
}

function taskQaRequestId(taskId: string, sourceRunId: string): string {
  const chars = createHash("sha256").update(`storyboard-qa:${taskId}:${sourceRunId}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 3) | 8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function prepareTaskQaRun(input: TaskQaInput, notesDir = getNotesDir()): TaskQaPreparation {
  const scenario = buildTaskQaScenario(input);
  if (!scenario) return { skipped: true, reason: "QA skipped: no runnable app or preview URL was found on the task or in its note." };
  saveScenario(scenario, notesDir);
  const prepared = prepareQaRun({
    scenarioId: scenario.id,
    requestId: taskQaRequestId(input.task.id, input.baseline ? `baseline:${input.sourceRunId}` : input.sourceRunId),
    taskId: input.task.id,
    ...(input.baseline ? { baseline: true } : {}),
  }, notesDir);
  return { skipped: false, ...prepared };
}

function belongsToOrchestration(run: QaRunRecord, record: OrchestrationRecord): boolean {
  return run.orchestrationId
    ? run.orchestrationId === (record.auto?.cycleId ?? record.createdAt)
    : Date.parse(run.createdAt) >= Date.parse(record.createdAt);
}

/** Check lifecycle identity under the same lock as Reset before touching task state. */
async function updateQaOrchestration(run: QaRunRecord, notesDir: string, update: (record: OrchestrationRecord) => OrchestrationRecord | null): Promise<boolean> {
  const taskId = run.taskId;
  if (!taskId) return true;
  return withOrchestrationMutationLock(taskId, notesDir, async () => {
    const current = readOrchestration(taskId, notesDir);
    if (!current || !belongsToOrchestration(run, current) || current.terminal || ["paused-manual", "stopped"].includes(current.status)) return false;
    await mutateOrchestration(taskId, null, record => record ? update(record) : null, notesDir);
    return true;
  });
}

/** Reserve synchronously before returning 202. Replays do not spend twice. */
export function prepareQaRun(raw: unknown, notesDir = getNotesDir()): { run: QaRunRecord; execute?: () => Promise<void> } {
  const input = StartSchema.parse(raw);
  const previous = listRuns(notesDir).find(run => run.requestId === input.requestId);
  if (previous) {
    if (previous.scenarioId !== input.scenarioId || previous.taskId !== input.taskId) throw new StoryboardError("That QA request ID was already used for another run.", 409);
    return { run: previous };
  }
  if (jobs.size >= 1) throw new StoryboardError("A QA run is already active. Wait for it or cancel it first.", 409);
  const scenario = listScenarios(notesDir).find(row => row.id === input.scenarioId);
  if (!scenario) throw new StoryboardError("QA scenario not found.", 404);
  const record = input.taskId ? readOrchestration(input.taskId, notesDir) : null;
  if (input.taskId) {
    if (!record) throw new StoryboardError("Start this task in Storyboard before attaching verification.", 409);
    if (record.terminal || ["stopped", "paused-manual"].includes(record.status)) throw new StoryboardError("This task is stopped or in Manual mode.", 409);
  }
  const settings = readSettings(notesDir);
  const run: QaRunRecord = {
    id: randomUUID(), requestId: input.requestId, scenarioId: scenario.id, taskId: input.taskId,
    createdAt: new Date().toISOString(), state: "running", revision: input.revision, ownerPid: process.pid,
    ...(record ? { orchestrationId: record.auto?.cycleId ?? record.createdAt } : {}),
    ...(input.baseline ? { baseline: true } : {}),
  };
  const controller = new AbortController();
  const release = claimQaLease(run.id, notesDir);
  try { writeRun(run, notesDir); } catch (error) { release(); throw error; }
  jobs.set(run.id, controller);
  return { run, execute: async () => {
    try {
      if (!await updateQaOrchestration(run, notesDir, current => {
        if (controller.signal.aborted || run.baseline || current.auto) return null;
        current.executionStep = "verify";
        current.status = "running";
        return current;
      })) controller.abort();
      controller.signal.throwIfAborted();
      const outputDir = runDir(run.id, notesDir);
      const driver = scenario.surface === "desktop" ? new DesktopDriver(scenario.bundleId!, outputDir) : new BrowserDriver({
        url: scenario.url!, outputDir, surface: scenario.surface, actions: scenario.actions,
        deathText: scenario.deathText, clearText: scenario.clearText, observeSelector: scenario.observeSelector, context: scenario.context,
      });
      const receipt = await runQa(scenario, driver, {
        text: jevPolicy({ apiKey: typesafeApiKey }),
        vision: jevPolicy({ apiKey: typesafeApiKey, images: true }),
        fallback: visionPolicy(settings),
        experimentalImages: settings.experimentalImages, minConfidence: settings.minConfidence,
      }, { id: run.id, signal: controller.signal, onStep: async (_step, receipt) => {
        run.receipt = receipt; writeRun(run, notesDir);
        if (run.taskId) {
          const current = readOrchestration(run.taskId, notesDir);
          if (!current || !belongsToOrchestration(run, current) || current.terminal || ["paused-manual", "stopped"].includes(current.status)) controller.abort();
        }
      } });
      receipt.revision = run.revision;
      run.receipt = receipt;
      run.state = "finished";
      writeRun(run, notesDir);
      if (run.taskId && !run.baseline) await attachVerification(run.taskId, receipt, notesDir);
    } catch {
      run.receipt = run.receipt ?? interruptedReceipt(run);
      run.receipt.status = "blocked";
      run.receipt.stopReason = controller.signal.aborted ? "QA was cancelled or the task was reset." : "QA setup or receipt attachment failed. Check the scenario and retry.";
      run.receipt.endedAt = new Date().toISOString();
      run.state = "finished";
      writeRun(run, notesDir);
      if (run.taskId && !run.baseline) await attachVerification(run.taskId, run.receipt, notesDir);
    } finally {
      jobs.delete(run.id);
      release();
    }
  } };
}

export async function attachVerification(taskId: string, receipt: QaReceipt, notesDir = getNotesDir()): Promise<void> {
  const run: QaRunRecord = readRun(receipt.id, notesDir) ?? { id: receipt.id, requestId: receipt.id, scenarioId: receipt.scenarioId, taskId, createdAt: receipt.startedAt, state: "finished" };
  if (run.baseline || run.taskId !== taskId) return;
  await updateQaOrchestration(run, notesDir, current => {
    // Auto mode reads the receipt itself and decides (fix round, cap, ready); see lib/storyboard/auto-mode.ts.
    if (current.auto) return null;
    current.executionStep = "verify";
    const questionId = "qa-" + receipt.id;
    const sameScenarioQuestions = new Set([questionId, ...listRuns(notesDir)
      .filter(run => run.taskId === taskId && run.scenarioId === receipt.scenarioId).map(run => "qa-" + run.id)]);
    current.questions = current.questions.map(question => sameScenarioQuestions.has(question.id) && question.state === "open" && receipt.status === "passed"
      ? { ...question, state: "answered", answer: "QA rerun passed.", answeredAt: receipt.endedAt } : question);
    if (receipt.status === "passed") {
      current.status = current.questions.some(question => question.state === "open") ? "needs-you" : "paused";
      current.lastError = "QA passed. Review the receipt before creating a draft PR.";
    } else {
      current.status = "needs-you";
      current.lastError = "QA did not pass: " + receipt.stopReason;
      if (!current.questions.some(question => question.id === questionId)) current.questions.push({
        id: questionId, stepId: "verify", kind: "blocker", state: "open", askedAt: receipt.endedAt,
        prompt: `QA needs you: ${receipt.title} — ${receipt.stopReason}. Open the QA receipt and rerun after fixing the failure.`,
      });
    }
    return current;
  });
}
export function cancelQaRun(id: string): boolean {
  const controller = jobs.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
export async function qaRunsWithRecovery(notesDir = getNotesDir()): Promise<QaRunRecord[]> {
  const runs = listRuns(notesDir);
  for (const run of runs) {
    if (run.state !== "running" || jobs.has(run.id) || processAlive(run.ownerPid)) continue;
    // Never mistake a process restart for a passing run.
    const receipt: QaReceipt = run.receipt ?? {
      schemaVersion: 1, id: run.id, scenarioId: run.scenarioId, title: run.scenarioId, surface: "dom",
      startedAt: run.createdAt, endedAt: "", status: "blocked", stopReason: "", goals: [], steps: [], artifacts: [], errors: [],
      totals: { durationMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unknownCostCalls: 0 },
    };
    receipt.status = "blocked"; receipt.stopReason = "DevHub restarted before QA finished."; receipt.endedAt = new Date().toISOString();
    run.state = "finished"; run.receipt = receipt;
    writeRun(run, notesDir);
    if (run.taskId) await attachVerification(run.taskId, receipt, notesDir);
  }
  return runs;
}
