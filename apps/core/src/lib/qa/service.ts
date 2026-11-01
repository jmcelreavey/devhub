import { createHash, randomUUID } from "node:crypto";
import { parseTaskQaScenario, taskQaSources, type TaskQaScenario } from "../../../../../packages/shared/task-note/qa-scenario.ts";
import { typesafeApiKey } from "./credentials";
import { jevPolicy, runQa, type QaReceipt } from "@devhub/qa";
import { BrowserDriver } from "@devhub/qa/browser";
import { getNotesDir } from "../notes/dir";
import { readOrchestration, mutateOrchestration, withOrchestrationMutationLock } from "../storyboard/orchestration-store";
import { isManagedPreviewForTask, leaseManagedPreviewForTask, managedPreviewForTask, verifyManagedPreviewForTask } from "../storyboard/preview";
import type { OrchestrationRecord } from "../../../../../packages/shared/ui-lib/storyboard/types";
import { StoryboardError } from "../storyboard/errors";
import type { Task } from "../../../../../packages/shared/tasks/types";
import { DesktopDriver } from "./desktop";
import { listRuns, listScenarios, normalizeQaReceipt, readRun, readSettings, runDir, writeRun, type QaRunRecord } from "./store";
import { visionPolicy } from "./vision";
import { ScenarioSchema, StartSchema, type SavedScenario } from "./schema";
import { claimQaLease, processAlive } from "./lease";
import { interruptedReceipt } from "./interrupted-receipt";
import { jevFailingGoals, qaFailureCategory } from "../../../../../packages/shared/ui-lib/qa/jev-summary";

const shared = globalThis as typeof globalThis & { __devhubQaJobs?: Map<string, AbortController> };
const jobs = shared.__devhubQaJobs ??= new Map<string, AbortController>();

const TARGET_LABEL = /\b(?:app|application|preview|demo|target)(?:\s+url)?\b/i;
const QA_ERROR_ADVICE: Record<string, string> = {
  EACCES: "check access to the QA files",
  EPERM: "check access to the QA files",
  ENOENT: "check that the required file or browser is installed",
  ENOTDIR: "check that the QA storage path is a directory",
  EEXIST: "check for a conflicting QA file or directory",
  EROFS: "check that QA storage is writable",
  EIO: "check the storage or device used for QA",
  ENOSPC: "free disk space for QA evidence",
  ETIMEDOUT: "check that the preview is reachable",
  ECONNREFUSED: "check that the preview is running",
  ECONNRESET: "check preview or provider connectivity",
  ENOTFOUND: "check preview or provider connectivity",
  QA_PREVIEW_UNAVAILABLE: "the managed task preview stopped or changed; start it again before retrying",
};

const QA_ERROR_OPERATIONS = new Set(["access", "open", "read", "write", "rename", "mkdir", "rmdir", "stat", "lstat", "unlink", "connect", "spawn"]);
const QA_STAGE_ADVICE = {
  "task state": "Check the task's Storyboard state and notes access, then retry QA.",
  "browser setup": "Check the preview and QA browser setup, then retry QA.",
  "QA execution": "Check the scenario and preview, then retry QA.",
  "receipt storage": "Check notes storage access and free disk space, then retry QA.",
  "receipt attachment": "Check the task state and notes access, then retry QA.",
} as const;
type QaExecutionStage = keyof typeof QA_STAGE_ADVICE;

function errorDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function qaErrorKind(error: unknown): string {
  try {
    if (error instanceof StoryboardError) return "StoryboardError";
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof URIError) return "URIError";
    return error instanceof Error ? "Error" : "NonError";
  } catch {
    return "NonError";
  }
}

export function qaErrorDetails(error: unknown): { code?: string; kind: string; operation?: string; summary: string } {
  let current = error;
  let code: string | undefined;
  let operation: string | undefined;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    const rawCode = errorDataProperty(current, "code");
    const rawOperation = errorDataProperty(current, "syscall");
    if (!code && typeof rawCode === "string" && Object.prototype.hasOwnProperty.call(QA_ERROR_ADVICE, rawCode)) code = rawCode;
    if (!operation && typeof rawOperation === "string" && QA_ERROR_OPERATIONS.has(rawOperation)) operation = rawOperation;
    current = errorDataProperty(current, "cause");
  }
  const kind = qaErrorKind(error);
  return {
    kind,
    ...(code ? { code } : {}),
    ...(operation ? { operation } : {}),
    summary: code ? `${code} (${QA_ERROR_ADVICE[code]})` : kind !== "Error" && kind !== "NonError" ? `unexpected ${kind}` : "unexpected error",
  };
}

export interface TaskQaInput {
  task: Pick<Task, "id" | "text" | "links">;
  noteMarkdown?: string | null;
  sourceRunId: string;
  /** Task-start capture of the app before the change, used as the card's "before" video. */
  baseline?: boolean;
  targetUrl?: string;
  shouldContinue?: () => Promise<boolean>;
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

export function buildTaskQaScenario(input: Pick<TaskQaInput, "task" | "noteMarkdown" | "targetUrl">, scenarios: readonly SavedScenario[] = []): { scenario: SavedScenario; taskAssertions?: TaskQaScenario } | { reason: string } {
  const url = (input.targetUrl ? httpUrl(input.targetUrl) : null) ?? taskQaTargetUrl(input.task, input.noteMarkdown);
  if (!url) return { reason: "QA skipped: no runnable app or preview URL was found on the task or in its note." };
  const markdown = input.noteMarkdown ?? "";
  const { references, declarations, unclosed, verificationSections } = taskQaSources(markdown);
  if (verificationSections > 1) return { reason: "QA skipped: combine the task note's Verification sections into one with a single QA source, then re-run QA." };
  if (references.length > 0 && (declarations.length > 0 || unclosed)) return { reason: "QA skipped: Verification has both a saved QA scenario reference and a task QA declaration. Remove one; if keeping the declaration, close its code fence before re-running QA." };
  if (references.length > 1) return { reason: "QA skipped: specify only one QA scenario under Verification." };
  if (references.some((reference) => !reference)) return { reason: "QA skipped: specify a saved QA scenario name or ID, or remove the empty reference under Verification." };
  if (unclosed || declarations.length > 1) return { reason: "QA skipped: close the task QA declaration and keep only one under Verification." };
  if (references.length === 0) {
    if (declarations.length === 0) return { reason: "QA skipped: add task-specific QA assertions or a 'QA scenario: <name or ID>' under Verification, then re-run QA." };
    let raw: unknown;
    try {
      raw = declarations[0].length <= 10_000 ? JSON.parse(declarations[0]) : null;
    } catch {
      return { reason: "QA skipped: the task QA declaration is not valid JSON. Update it and re-run QA." };
    }
    const parsed = parseTaskQaScenario(raw);
    if (!parsed.ok) return { reason: `QA skipped: ${parsed.error} Update the task QA declaration and re-run QA.` };
    return {
      taskAssertions: parsed.scenario,
      scenario: ScenarioSchema.parse({
        id: `task-${createHash("sha256").update(input.task.id).digest("hex").slice(0, 24)}`,
        title: `Task QA: ${(plainGoalText(input.task.text) ?? "UI outcome").slice(0, 150)}`,
        surface: "dom", url,
        goals: parsed.scenario.goals.map((goal, index) => ({ id: `goal-${index + 1}`, ...goal })),
        actions: [{ id: "wait", description: "Wait briefly for content", kind: "wait", holdMs: 500 }],
        maxSteps: 4, maxDurationMs: 300_000, maxCostUsd: 0.1, stallSteps: 3,
      }),
    };
  }
  const reference = references[0];
  const explicitId = reference.startsWith("id:") ? reference.slice(3).trim() : null;
  const matches = scenarios.filter((scenario) => explicitId !== null ? scenario.id === explicitId : scenario.id === reference || scenario.title.toLowerCase() === reference.toLowerCase());
  if (matches.length === 0) return { reason: "QA skipped: the referenced scenario was not found in QA lab. Create it or update the task, then re-run QA." };
  if (matches.length > 1) return { reason: "QA skipped: the scenario name is ambiguous. Use 'QA scenario: id:<unique ID>' under Verification, then re-run QA." };
  const selected = matches[0];
  if (selected.surface === "desktop") return { reason: "QA skipped: task preview QA requires a web scenario, not a desktop scenario." };
  if (!selected.actions?.length) return { reason: "QA skipped: the saved scenario has no explicit wait-only action menu. Add task assertions or run it manually against an isolated preview." };
  if (selected.actions.some((action) => action.kind !== "wait")) return { reason: "QA skipped: the saved scenario includes interactive actions. Add task assertions or run it manually against an isolated preview." };
  const outcome = selected.goals.some((goal) => {
    if (goal.assertion === "no-errors") return false;
    if (goal.assertion === "visible") return Boolean(goal.selector?.trim()) && !/^(?:body|html)$/i.test(goal.selector!.trim());
    return Boolean(goal.expected?.trim());
  });
  if (!outcome) return { reason: "QA skipped: add an explicit task outcome assertion to the saved scenario, then re-run QA." };
  const title = plainGoalText(input.task.text)?.slice(0, 1000) || "Complete the task outcome";
  const description = plainGoalText(markdownSection(markdown, [/^##\s+Description\b/i]));
  const acceptance = plainGoalText(markdownSection(markdown, [/^##\s+Acceptance(?:\s+criteria)?\b/i]));
  return { scenario: ScenarioSchema.parse({
    ...selected,
    url,
    context: [selected.context, `Task title: ${title}`, description ? `Description: ${description}` : null, acceptance ? `Acceptance: ${acceptance}` : null].filter((line): line is string => Boolean(line)).join("\n").slice(0, 4000),
  }) };
}

export function taskQaRequestId(taskId: string, sourceRunId: string): string {
  const chars = createHash("sha256").update(`storyboard-qa:${taskId}:${sourceRunId}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 3) | 8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function prepareTaskQaRun(input: TaskQaInput, notesDir = getNotesDir()): TaskQaPreparation {
  const managedUrl = managedPreviewForTask(input.task.id);
  if (!managedUrl) {
    return { skipped: true, reason: "QA skipped: no running DevHub-managed opt-in preview belongs to this task. Configure the repo preview or run QA manually against an isolated preview." };
  }
  const selected = buildTaskQaScenario({ ...input, targetUrl: managedUrl }, listScenarios(notesDir));
  if ("reason" in selected) return { skipped: true, reason: selected.reason };
  if (!selected.scenario.url || !isManagedPreviewForTask(input.task.id, selected.scenario.url)) {
    return { skipped: true, reason: "QA skipped: the DevHub-managed preview for this task stopped or changed. Start it again before retrying." };
  }
  const prepared = prepareQaRunWithScenario({
    scenarioId: selected.scenario.id,
    requestId: taskQaRequestId(input.task.id, input.baseline ? `baseline:${input.sourceRunId}` : input.sourceRunId),
    taskId: input.task.id,
    ...(input.baseline ? { baseline: true } : {}),
  }, notesDir, selected.scenario, selected.taskAssertions, input.shouldContinue);
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
  return prepareQaRunWithScenario(raw, notesDir);
}

function prepareQaRunWithScenario(raw: unknown, notesDir: string, selected?: SavedScenario, taskAssertions?: TaskQaScenario, shouldContinue?: () => Promise<boolean>): { run: QaRunRecord; execute?: () => Promise<void> } {
  const input = StartSchema.parse(raw);
  const previous = listRuns(notesDir).find(run => run.requestId === input.requestId);
  if (previous) {
    if (previous.scenarioId !== input.scenarioId || previous.taskId !== input.taskId) throw new StoryboardError("That QA request ID was already used for another run.", 409);
    return { run: previous };
  }
  if (jobs.size >= 1) throw new StoryboardError("A QA run is already active. Wait for it or cancel it first.", 409);
  const scenario = selected?.id === input.scenarioId ? selected : listScenarios(notesDir).find(row => row.id === input.scenarioId);
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
    ...(taskAssertions ? { taskAssertions } : {}),
    ...(record ? { orchestrationId: record.auto?.cycleId ?? record.createdAt } : {}),
    ...(input.baseline ? { baseline: true } : {}),
  };
  const controller = new AbortController();
  const release = claimQaLease(run.id, notesDir);
  try { writeRun(run, notesDir); } catch (error) { release(); throw error; }
  jobs.set(run.id, controller);
  return { run, execute: async () => {
    let stage: QaExecutionStage = "task state";
    let previewRevoked = false;
    let taskChanged = false;
    let reportingError: Error | undefined;
    let cleanupError: Error | undefined;
    const checkTask = async () => {
      if (!controller.signal.aborted && shouldContinue && !await shouldContinue()) {
        taskChanged = true;
        controller.abort();
      }
    };
    const releasePreview = selected && run.taskId && scenario.url ? leaseManagedPreviewForTask(run.taskId, scenario.url) : null;
    const managedScenarioAvailable = async () => !selected || !run.taskId || Boolean(scenario.url && await verifyManagedPreviewForTask(run.taskId, scenario.url));
    try {
      if (selected && !releasePreview) {
        throw Object.assign(new Error("Managed task preview lease is unavailable."), { code: "QA_PREVIEW_UNAVAILABLE" });
      }
      if (!await updateQaOrchestration(run, notesDir, current => {
        if (controller.signal.aborted || run.baseline || current.auto) return null;
        current.executionStep = "verify";
        current.status = "running";
        return current;
      })) controller.abort();
      await checkTask();
      controller.signal.throwIfAborted();
      stage = "browser setup";
      if (!await managedScenarioAvailable()) {
        throw Object.assign(new Error("Managed task preview is unavailable."), { code: "QA_PREVIEW_UNAVAILABLE" });
      }
      const outputDir = runDir(run.id, notesDir);
      const driver = scenario.surface === "desktop" ? new DesktopDriver(scenario.bundleId!, outputDir) : new BrowserDriver({
        url: scenario.url!, outputDir, surface: scenario.surface, actions: scenario.actions,
        ...(selected && run.taskId ? { restrictToAllowedOrigins: true } : {}),
        deathText: scenario.deathText, clearText: scenario.clearText, observeSelector: scenario.observeSelector, context: scenario.context,
      });
      stage = "QA execution";
      const jevOptions = { apiKey: typesafeApiKey, ...(run.taskId ? { timeoutMs: 120_000 } : {}) };
      const onProgress = async (receipt: QaReceipt) => {
        await checkTask();
        if (!controller.signal.aborted && !await managedScenarioAvailable()) {
          previewRevoked = true;
          controller.abort();
        }
        stage = "receipt storage";
        run.receipt = receipt; writeRun(run, notesDir);
        stage = "QA execution";
        if (run.taskId) {
          const current = readOrchestration(run.taskId, notesDir);
          if (!current || !belongsToOrchestration(run, current) || current.terminal || ["paused-manual", "stopped"].includes(current.status)) controller.abort();
        }
      };
      const receipt = normalizeQaReceipt(await runQa(scenario, driver, {
        text: jevPolicy(jevOptions),
        vision: jevPolicy({ ...jevOptions, images: true }),
        fallback: visionPolicy(settings),
        experimentalImages: settings.experimentalImages, minConfidence: settings.minConfidence,
      }, {
        id: run.id, signal: controller.signal,
        onStep: async (_step, receipt) => onProgress(receipt),
        ...(taskAssertions ? { assertionWaitMs: run.baseline ? 2_000 : 60_000, onAssertion: onProgress } : {}),
      }));
      await checkTask();
      if (!controller.signal.aborted && !await managedScenarioAvailable()) previewRevoked = true;
      if (taskChanged) {
        receipt.status = "blocked";
        receipt.stopReason = "The task or pinned checkout changed during QA. Run QA again.";
      } else if (previewRevoked) {
        receipt.status = "blocked";
        receipt.stopReason = "The managed task preview stopped or its configuration changed. Start it again before retrying QA.";
      }
      receipt.revision = run.revision;
      run.receipt = receipt;
      run.state = "finished";
      stage = "receipt storage";
      writeRun(run, notesDir);
      stage = "receipt attachment";
      if (run.taskId && !run.baseline) await attachVerification(run.taskId, receipt, notesDir);
    } catch (error) {
      const { summary, ...diagnostic } = qaErrorDetails(error);
      if (!controller.signal.aborted) console.error("[qa] execution failed", { runId: run.id, stage, ...diagnostic });
      run.receipt = run.receipt ?? interruptedReceipt(run);
      run.receipt.status = "blocked";
      run.receipt.stopReason = taskChanged ? "The task or pinned checkout changed during QA. Run QA again." : previewRevoked ? "The managed task preview stopped or its configuration changed. Start it again before retrying QA." : controller.signal.aborted ? "QA was cancelled or the task was reset." : `QA failed during ${stage}: ${summary}. ${QA_STAGE_ADVICE[stage]} If it persists, report run ${run.id} and the stage.`;
      run.receipt.endedAt = new Date().toISOString();
      run.state = "finished";
      try {
        stage = "receipt storage";
        writeRun(run, notesDir);
        stage = "receipt attachment";
        if (run.taskId && !run.baseline) await attachVerification(run.taskId, run.receipt, notesDir);
      } catch (reportError) {
        const { summary: reportSummary, ...reportDiagnostic } = qaErrorDetails(reportError);
        console.error("[qa] failure reporting failed", { runId: run.id, stage, ...reportDiagnostic });
        reportingError = new Error(`QA failure reporting failed during ${stage}: ${reportSummary}. Check notes storage and report run ${run.id}.`);
      }
    } finally {
      releasePreview?.();
      jobs.delete(run.id);
      try {
        release();
      } catch (releaseError) {
        const { summary: releaseSummary, ...releaseDiagnostic } = qaErrorDetails(releaseError);
        console.error("[qa] lease cleanup failed", { runId: run.id, ...releaseDiagnostic });
        cleanupError = new Error(`QA lease cleanup failed: ${releaseSummary}. Check notes storage and report run ${run.id}.`);
      }
    }
    if (reportingError && cleanupError) throw new AggregateError([reportingError, cleanupError], "QA failure reporting and lease cleanup failed.");
    if (reportingError) throw reportingError;
    if (cleanupError) throw cleanupError;
  } };
}

export async function attachVerification(taskId: string, input: QaReceipt, notesDir = getNotesDir()): Promise<void> {
  const recorded = readRun(input.id, notesDir);
  const run: QaRunRecord = recorded ?? { id: input.id, requestId: input.id, scenarioId: input.scenarioId, taskId, createdAt: input.startedAt, state: "finished" };
  const receipt = recorded?.state === "finished" && recorded.receipt ? recorded.receipt : { ...normalizeQaReceipt(input), status: "blocked" as const, stopReason: "QA run or finished receipt is missing." };
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
      const category = qaFailureCategory(receipt);
      const findings = jevFailingGoals({ ...run, receipt });
      const prompt = `QA needs you: ${category}${findings.length ? ` ${findings.join("; ")}.` : ""} Open the QA receipt and rerun after fixing the failure.`;
      current.lastError = "QA did not pass: " + category;
      current.questions = current.questions.map(question => question.id === questionId ? { ...question, prompt } : question);
      if (!current.questions.some(question => question.id === questionId)) current.questions.push({
        id: questionId, stepId: "verify", kind: "blocker", state: "open", askedAt: receipt.endedAt,
        prompt,
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
