import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelUsage, QaAction, QaDriver, QaScenario, Routing } from "../../qa/src/index";
import { textToBlocks } from "../markdown-convert/index";
import { attachVerification, buildTaskQaScenario, cancelQaRun, prepareQaRun, prepareTaskQaRun, qaErrorDetails } from "../../../apps/core/src/lib/qa/service.ts";
import { jevInfoByTask } from "../ui-lib/qa/jev-summary.ts";
import { interruptedReceipt } from "../../../apps/core/src/lib/qa/interrupted-receipt.ts";
import { ScenarioSchema } from "../../../apps/core/src/lib/qa/schema.ts";
import { listRuns, listScenarios, saveScenario, writeRun } from "../../../apps/core/src/lib/qa/store.ts";
import { newAutoState } from "../../../apps/core/src/lib/storyboard/auto-mode.ts";
import { buildNotesBoard } from "../../../apps/core/src/lib/storyboard/notes-board.ts";
import { summariseOrchestration } from "../ui-lib/storyboard/orchestration.ts";
import { mutateOrchestration, newOrchestration, orchestrationsDir, readOrchestration } from "../../../apps/core/src/lib/storyboard/orchestration-store.ts";
import { ensurePreview, leaseManagedPreviewForTask, listPreviews, stopPreview } from "../../../apps/core/src/lib/storyboard/preview.ts";
import { autoDeps, reconcileOrchestration, type OrchestratorDeps } from "../../../apps/core/src/lib/storyboard/orchestrator.ts";
import { buildAutoFixPrompt } from "../../../apps/core/src/domains/tasks/auto-prompts.ts";
import { patchTaskAgentRun, upsertTaskAgentRun } from "../../../apps/core/src/domains/tasks/task-agent-runs.ts";
import type { Task } from "../tasks/types.ts";

const qaPackage: typeof import("../../qa/src/index") = await import(createRequire(new URL("../../../apps/ui/package.json", import.meta.url)).resolve("@devhub/qa"));
const { DecisionError, jevPolicy, runQa } = qaPackage;
const task = { id: "qa-safe-task", text: "Show the result", links: [] };
const declaration = '## Verification\n```devhub-qa\n{"goals":[{"description":"Result","assertion":"text","selector":"#result","expected":"Ready"}]}\n```';
const previewUrl = "http://localhost:4173/";
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-qa-test-")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

function savedScenario(actions?: QaAction[]) {
  return ScenarioSchema.parse({
    id: "saved-scenario", title: "Saved scenario", surface: "dom", url: "http://localhost:3000/",
    goals: [{ id: "result", description: "Result", assertion: "text", selector: "#result", expected: "Ready" }],
    ...(actions ? { actions } : {}),
  });
}

async function managedPreview() {
  const upstarts = path.join(dir, "upstarts");
  const configDir = path.join(upstarts, "qa-test-repo");
  const site = path.join(dir, "site");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, "index.html"), "<h1>Ready</h1>");
  fs.writeFileSync(path.join(configDir, "preview.json"), JSON.stringify({ autoStart: true, kind: "static", directory: "site" }));
  vi.stubEnv("UPSTARTS_DIR", upstarts);
  const input = { taskId: task.id, repoName: "qa-test-repo", cwd: dir };
  const preview = await ensurePreview(input);
  expect(preview.state).toBe("started");
  if (!preview.url) throw new Error("The static preview did not start.");
  return { url: preview.url, input, stop: () => stopPreview(input.taskId) };
}

describe("task QA source parsing", () => {
  const block = declaration.replace(/^## Verification\n/, "");
  const reference = "QA scenario: saved-scenario";
  const saved = savedScenario([{ id: "wait", description: "Wait", kind: "wait" }]);

  it.each([
    ["a reference followed by a declaration", `${reference}\n${block}`],
    ["a declaration followed by a reference", `${block}\n${reference}`],
    ["a reference followed by an unclosed declaration", `${reference}\n\`\`\`devhub-qa\n{`],
    ["a reference and multiple declarations", `${reference}\n${block}\n${block}`],
    ["an empty reference and a declaration", `QA scenario:\n${block}`],
    ["multiple references", `${reference}\n${reference}`],
    ["multiple declarations", `${block}\n${block}`],
    ["an unclosed declaration", "```devhub-qa\n{"],
    ["sources in repeated Verification sections", `${reference}\n## Other\nContext\n## Verification\n${block}`],
  ])("skips %s", (_description, content) => {
    const result = buildTaskQaScenario({ task, noteMarkdown: `## Verification\n${content}`, targetUrl: previewUrl }, [saved]);
    expect(result).toMatchObject({ reason: expect.stringContaining("QA skipped:") });
  });

  it("accepts a single reference while ignoring commented and fenced examples", () => {
    const noteMarkdown = `## Background\n${block}\n## Verification\n${reference}\n<!--\n${block}\n-->\n~~~~text\n${block}\n~~~~`;
    const result = buildTaskQaScenario({ task, noteMarkdown, targetUrl: previewUrl }, [saved]);
    expect(result).toMatchObject({ scenario: { id: saved.id } });
  });

  it("accepts a single declaration while ignoring a commented reference", () => {
    const noteMarkdown = `## Verification\n<!-- ${reference} -->\n${block}`;
    const result = buildTaskQaScenario({ task, noteMarkdown, targetUrl: previewUrl }, [saved]);
    expect(result).toMatchObject({ taskAssertions: { goals: [{ expected: "Ready" }] } });
  });

  it.each([
    { goals: [{ description: "Result", assertion: "text", selector: "#result", expected: "Ready" }], url: "https://example.invalid" },
    { goals: [{ description: "Result", assertion: "text", selector: "#result", expected: "Ready" }], actions: [{ kind: "click" }] },
    { goals: [{ description: "Result", assertion: "text", selector: "#result", expected: "Ready", action: "click" }] },
  ])("rejects unsafe fields in directly edited declarations", (candidate) => {
    const noteMarkdown = `## Verification\n\`\`\`devhub-qa\n${JSON.stringify(candidate)}\n\`\`\``;
    expect(buildTaskQaScenario({ task, noteMarkdown, targetUrl: previewUrl })).toMatchObject({ reason: expect.stringContaining("QA skipped") });
  });
});

describe("QA diagnostics security", () => {
  it("reports allowlisted nested error details without exposing untrusted values or invoking getters", () => {
    const secret = "private-qa-diagnostic-token";
    const cause = Object.assign(new Error(`Access denied: ${secret}`), { code: "EACCES", syscall: "open", path: `/tmp/${secret}` });
    const error = new TypeError(`Bearer ${secret}`, { cause });
    const details = qaErrorDetails(error);
    expect(details).toMatchObject({ code: "EACCES", kind: "TypeError", operation: "open" });
    expect(JSON.stringify(details)).not.toContain(secret);

    let accessed = false;
    const hostile = new Error(secret);
    Object.defineProperty(hostile, "code", { get: () => { accessed = true; throw new Error(secret); } });
    Object.defineProperty(hostile, "cause", { get: () => { accessed = true; throw new Error(secret); } });
    Object.defineProperty(hostile, "syscall", { value: `open-${secret}` });
    expect(JSON.stringify(qaErrorDetails(hostile))).not.toContain(secret);
    expect(accessed).toBe(false);
  });

  it("records a safe diagnostic when task state fails before a baseline starts", async () => {
    const secret = "private-state-token";
    const taskId = `task-${secret}`;
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-26" }), dir);
    saveScenario(savedScenario(), dir);
    const prepared = prepareQaRun({ taskId, scenarioId: "saved-scenario", requestId: randomUUID(), baseline: true }, dir);
    fs.writeFileSync(path.join(orchestrationsDir(dir), `${taskId}.json`), "{");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await prepared.execute!();
      const receipt = listRuns(dir)[0].receipt!;
      expect(receipt).toMatchObject({ status: "blocked", stopReason: expect.stringContaining("task state") });
      expect(log).toHaveBeenCalledWith("[qa] execution failed", expect.objectContaining({ runId: prepared.run.id, stage: "task state", kind: "StoryboardError" }));
      expect(JSON.stringify({ stopReason: receipt.stopReason, logs: log.mock.calls })).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  it("does not leak paths when saving a failure receipt also fails", async () => {
    const secret = "sensitive-notes-path";
    const notesDir = path.join(dir, "notes-" + secret);
    await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: "2026-10-26" }), notesDir);
    saveScenario(savedScenario(), notesDir);
    const prepared = prepareQaRun({ taskId: task.id, scenarioId: "saved-scenario", requestId: randomUUID(), baseline: true }, notesDir);
    fs.writeFileSync(path.join(orchestrationsDir(notesDir), task.id + ".json"), "{");
    const runDir = path.join(notesDir, ".config", "qa", "runs", prepared.run.id);
    fs.renameSync(runDir, runDir + "-retained");
    fs.writeFileSync(runDir, "not a directory");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure: unknown = await prepared.execute!().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("QA failure reporting failed");
      expect(log).toHaveBeenCalledWith("[qa] failure reporting failed", expect.objectContaining({ runId: prepared.run.id, stage: "receipt storage" }));
      expect(JSON.stringify({ message: (failure as Error).message, logs: log.mock.calls })).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  it("does not leak malformed lease contents and preserves the blocked receipt", async () => {
    const secret = "sensitive-lease-content";
    await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: "2026-10-26" }), dir);
    saveScenario(savedScenario(), dir);
    const prepared = prepareQaRun({ taskId: task.id, scenarioId: "saved-scenario", requestId: randomUUID(), baseline: true }, dir);
    fs.writeFileSync(path.join(orchestrationsDir(dir), task.id + ".json"), "{");
    fs.writeFileSync(path.join(dir, ".config", "qa", "active.lock"), '{"secret":"' + secret + '",}');
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure: unknown = await prepared.execute!().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("QA lease cleanup failed");
      expect(log).toHaveBeenCalledWith("[qa] lease cleanup failed", expect.objectContaining({ runId: prepared.run.id, kind: "SyntaxError" }));
      expect(JSON.stringify({ message: (failure as Error).message, logs: log.mock.calls })).not.toContain(secret);
      expect(listRuns(dir)[0].receipt).toMatchObject({ status: "blocked" });
    } finally {
      log.mockRestore();
    }
  });

  it("recovers an existing queued task and sanitizes preparation failures", async () => {
    const runId = "run-qa123456-0000000a";
    const secret = "private-note-fixture-token";
    const brokenNote = path.join(dir, "broken-note.json");
    fs.writeFileSync(brokenNote, `{"token":"${secret}",}`);
    await upsertTaskAgentRun({ taskId: task.id, runId, status: "done", notesDir: dir });
    await mutateOrchestration(task.id, null, () => {
      const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
      record.status = "starting";
      record.executionStep = "verify";
      record.lastError = "QA queued: another Jev QA run owns the workspace.";
      record.runIds = [runId];
      return record;
    }, dir);
    const fullTask: Task = { ...task, done: false, startDate: "2026-10-26", createdAt: "", rank: "a" };
    const deps: OrchestratorDeps = {
      dispatch: async () => { throw new Error("not used"); },
      resolveRepos: async () => [],
      findTask: async () => fullTask,
      activeHeavyJobs: () => 0,
      activeQaJobs: () => 0,
      readPlanNote: () => JSON.parse(fs.readFileSync(brokenNote, "utf8")) as string,
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await reconcileOrchestration(task.id, deps, dir);
      expect(result.orchestration).toMatchObject({ status: "paused", runIds: [runId], lastError: expect.stringContaining("QA") });
      expect(log).toHaveBeenCalledWith("[qa] preparation failed", expect.objectContaining({ stage: "verification", kind: "SyntaxError" }));
      expect(JSON.stringify({ lastError: result.orchestration.lastError, logs: log.mock.calls })).not.toContain(secret);
      expect(fs.readFileSync(brokenNote, "utf8")).toContain(secret);
    } finally {
      log.mockRestore();
    }
  });
});

describe("automatic task QA security", () => {
  it("shares preview startup and cancellation across separately loaded modules", async () => {
    const upstarts = path.join(dir, "upstarts");
    fs.mkdirSync(path.join(upstarts, "qa-test-repo"), { recursive: true });
    fs.mkdirSync(path.join(dir, "site"));
    fs.writeFileSync(path.join(dir, "site", "index.html"), "Fixture");
    fs.writeFileSync(path.join(upstarts, "qa-test-repo", "preview.json"), JSON.stringify({ autoStart: true, kind: "static", directory: "site" }));
    vi.stubEnv("UPSTARTS_DIR", upstarts);
    vi.resetModules();
    const first = await import("../../../apps/core/src/lib/storyboard/preview.ts");
    vi.resetModules();
    const second = await import("../../../apps/core/src/lib/storyboard/preview.ts");
    const input = { taskId: "qa-preview-race", repoName: "qa-test-repo", cwd: dir };
    try {
      const pending = first.ensurePreview(input);
      expect(await second.ensurePreview(input)).toMatchObject({ state: "starting", url: null });
      first.stopPreview(input.taskId);
      expect(await pending).toMatchObject({ state: "none", url: null });
      expect(first.listPreviews().some((preview) => preview.taskId === input.taskId)).toBe(false);

      const cancelledFromOtherModule = first.ensurePreview(input);
      second.stopPreview(input.taskId);
      expect(await cancelledFromOtherModule).toMatchObject({ state: "none", url: null });
      expect(second.listPreviews().some((preview) => preview.taskId === input.taskId)).toBe(false);
    } finally {
      second.stopPreview(input.taskId);
    }
  });

  it("serves only the declared static directory and keeps a revoked listener bound for QA", async () => {
    const { url, stop } = await managedPreview();
    fs.writeFileSync(path.join(dir, "outside.txt"), "private fixture");
    const link = path.join(dir, "site", "outside.txt");
    if (process.platform !== "win32") fs.symlinkSync(path.join(dir, "outside.txt"), link);
    const response = await fetch(url);
    expect(await response.text()).toContain("Ready");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    if (process.platform !== "win32") expect((await fetch(new URL("/outside.txt", url))).status).toBe(403);

    const release = leaseManagedPreviewForTask(task.id, url);
    expect(release).not.toBeNull();
    try {
      stop();
      expect((await fetch(url)).status).toBe(410);
    } finally {
      release?.();
    }
  });

  it("will not serve the whole checkout as a static preview", async () => {
    const { input, stop } = await managedPreview();
    stop();
    fs.writeFileSync(path.join(dir, "upstarts", "qa-test-repo", "preview.json"), JSON.stringify({ autoStart: true, kind: "static", directory: "." }));
    expect(await ensurePreview(input)).toMatchObject({ state: "none", url: null });
  });

  it("reconciles a completed implementation against its opted-in managed preview", async () => {
    vi.stubEnv("NOTES_DIR", dir);
    vi.stubEnv("TASKS_DIR", path.join(dir, "tasks"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(dir, "agent-runs"));
    const { stop } = await managedPreview();
    const runId = "run-qa123456-0000000b";
    const fullTask: Task = { ...task, done: false, startDate: "2026-10-26", createdAt: "", rank: "a" };
    fs.mkdirSync(path.join(dir, "task-notes"));
    fs.writeFileSync(path.join(dir, "task-notes", `2026-10-26-${task.id}.json`), JSON.stringify({ content: textToBlocks(declaration) }));
    await upsertTaskAgentRun({ taskId: task.id, runId, status: "done", notesDir: dir });
    await patchTaskAgentRun(task.id, runId, { cwd: dir }, dir);
    await mutateOrchestration(task.id, null, () => {
      const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
      record.status = "running"; record.executionStep = "implement"; record.runIds = [runId]; record.repo = { name: "qa-test-repo", cwd: dir };
      return record;
    }, dir);
    const deps: OrchestratorDeps = { dispatch: async () => { throw new Error("not used"); }, resolveRepos: async () => [], findTask: async () => fullTask, activeHeavyJobs: () => 0, activeQaJobs: () => 0 };
    let execute: (() => Promise<void>) | undefined;
    try {
      const result = await reconcileOrchestration(task.id, deps, dir);
      execute = result.execute;
      expect(result.orchestration).toMatchObject({ status: "running", executionStep: "verify" });
      expect(execute).toBeDefined();
      expect(listRuns(dir)).toMatchObject([{ taskId: task.id, taskAssertions: { goals: [{ expected: "Ready" }] } }]);
      const active = listRuns(dir).find((run) => run.state === "running");
      if (!active || !execute) throw new Error("The automatic fixture did not prepare QA.");
      cancelQaRun(active.id);
      await execute();
      expect(listPreviews().some((preview) => preview.taskId === task.id)).toBe(false);
    } finally {
      const active = listRuns(dir).find((run) => run.state === "running");
      if (active && execute) { cancelQaRun(active.id); await execute(); }
      stop();
    }
  });

  it.each(["click", "fill", "select", "keys", "press", "scroll"] as const)("skips a saved scenario containing %s without changing manual QA", async (kind) => {
    const manual = savedScenario([{ id: "action", description: "Action", kind, selector: "#target", keys: ["Enter"] }]);
    saveScenario(manual, dir);
    const noteMarkdown = "## Verification\nQA scenario: saved-scenario";
    expect(buildTaskQaScenario({ task, noteMarkdown, targetUrl: previewUrl }, [manual])).toMatchObject({ reason: expect.stringContaining("interactive actions") });
    expect(listScenarios(dir)).toEqual([manual]);
    expect(listRuns(dir)).toEqual([]);
    const manualRun = prepareQaRun({ scenarioId: manual.id, requestId: randomUUID() }, dir);
    expect(manualRun.execute).toBeDefined();
    cancelQaRun(manualRun.run.id);
    await manualRun.execute!();
    expect(listScenarios(dir)).toEqual([manual]);
  });

  it("does not silently replace a missing or mixed action menu", () => {
    const input = { task, noteMarkdown: "## Verification\nQA scenario: saved-scenario", targetUrl: previewUrl };
    expect(buildTaskQaScenario(input, [savedScenario()])).toMatchObject({ reason: expect.stringContaining("wait-only") });
    const mixed = savedScenario([{ id: "wait", description: "Wait", kind: "wait" }, { id: "remove", description: "Remove", kind: "click", selector: "#remove" }]);
    expect(buildTaskQaScenario(input, [mixed])).toMatchObject({ reason: expect.stringContaining("interactive actions") });
    expect(mixed.actions).toHaveLength(2);
  });

  it.each([true, false])("refuses task URLs without managed provenance (baseline=%s)", (baseline) => {
    const input = { task, noteMarkdown: `${declaration}\n\n## Preview\n${previewUrl}`, sourceRunId: "run", baseline };
    expect(prepareTaskQaRun(input, dir)).toMatchObject({ skipped: true, reason: expect.stringContaining("DevHub-managed") });
    expect(prepareTaskQaRun({ ...input, targetUrl: "https://untrusted.example/" }, dir)).toMatchObject({ skipped: true, reason: expect.stringContaining("DevHub-managed") });
    expect(listRuns(dir)).toEqual([]);
  });

  it.each([
    ["disabled", JSON.stringify({ autoStart: false, kind: "static", directory: "site" })],
    ["removed", null],
    ["invalid", "{"],
    ["changed", JSON.stringify({ autoStart: true, kind: "static", directory: "site", path: "/other" })],
  ])("rejects a managed preview after its opt-in is %s", async (_change, contents) => {
    const { input } = await managedPreview();
    try {
      await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: "2026-10-26" }), dir);
      const prepared = prepareTaskQaRun({ task, noteMarkdown: declaration, sourceRunId: "before-change" }, dir);
      if (prepared.skipped || !prepared.execute) throw new Error("The opted-in fixture did not prepare QA.");
      const file = path.join(dir, "upstarts", "qa-test-repo", "preview.json");
      if (contents === null) fs.unlinkSync(file);
      else fs.writeFileSync(file, contents);
      expect(prepareTaskQaRun({ task, noteMarkdown: declaration, sourceRunId: "after-change" }, dir)).toMatchObject({ skipped: true });
      await prepared.execute();
      expect(listRuns(dir)[0]).toMatchObject({ state: "finished", receipt: { status: "blocked", stopReason: expect.stringContaining("QA_PREVIEW_UNAVAILABLE") } });
      expect(await ensurePreview(input)).toMatchObject({ state: "none", url: null });
    } finally {
      stopPreview(task.id);
    }
  });

  it("uses this task's managed preview, rechecks it before navigation, and preserves the declaration", async () => {
    const { url, stop } = await managedPreview();
    let stopped = false;
    try {
      await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: "2026-10-26" }), dir);
      expect(prepareTaskQaRun({ task: { ...task, id: "another-task" }, targetUrl: previewUrl, noteMarkdown: declaration, sourceRunId: "run" }, dir)).toMatchObject({ skipped: true });
      const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
      record.repo = { name: "qa-test-repo", cwd: dir };
      const fullTask: Task = { ...task, done: false, startDate: "2026-10-26", createdAt: "", rank: "a" };
      const deps: OrchestratorDeps = { dispatch: async () => { throw new Error("not used"); }, resolveRepos: async () => [], findTask: async () => null };
      expect(await autoDeps(deps, dir).resolvePreview({ record, task: fullTask, markdown: "Preview: https://untrusted.example/", cwd: dir })).toMatchObject({ state: "started", url });
      saveScenario(savedScenario([{ id: "remove", description: "Remove", kind: "click", selector: "#remove" }]), dir);
      expect(prepareTaskQaRun({ task, noteMarkdown: "## Verification\nQA scenario: saved-scenario", sourceRunId: "interactive" }, dir)).toMatchObject({ skipped: true, reason: expect.stringContaining("interactive actions") });
      const prepared = prepareTaskQaRun({ task, targetUrl: "https://untrusted.example/", noteMarkdown: declaration, sourceRunId: "run" }, dir);
      if (prepared.skipped) throw new Error(prepared.reason);
      expect(listRuns(dir)[0].taskAssertions).toMatchObject({ goals: [{ expected: "Ready" }] });
      expect(buildTaskQaScenario({ task, targetUrl: url, noteMarkdown: declaration.replace('"Ready"', '"Changed"') })).toMatchObject({ taskAssertions: { goals: [{ expected: "Changed" }] } });
      await stop(); stopped = true;
      await prepared.execute!();
      expect(listRuns(dir)[0]).toMatchObject({ state: "finished", taskAssertions: { goals: [{ expected: "Ready" }] }, receipt: { status: "blocked", stopReason: expect.stringContaining("QA_PREVIEW_UNAVAILABLE") } });
    } finally {
      if (!stopped) await stop();
    }
  });
});

function scenario(): QaScenario {
  return { id: "cold-load", title: "Cold load", surface: "dom", goals: [{ id: "result", description: "Result", assertion: "text", selector: "#result", expected: "Ready" }], maxSteps: 4, maxDurationMs: 120_000, maxCostUsd: 0.1, stallSteps: 3 };
}

function driver(passes: () => boolean, activity: string[]): QaDriver {
  return {
    surface: "dom",
    start: async () => undefined,
    observe: async () => { activity.push("observe"); return { text: "Loading", fingerprint: "loading", actions: [{ id: "delete", description: "Delete", kind: "click", selector: "#delete" }] }; },
    act: async () => { activity.push("act"); },
    assert: async (goals) => goals.map((goal) => ({ id: goal.id, description: goal.description, passed: passes(), actual: passes() ? "Ready" : "Loading" })),
    capture: async (phase) => ({ file: `${phase}.png`, kind: "image", phase, sha256: "a".repeat(64) }),
    close: async () => [{ file: "run.webm", kind: "video", phase: "after", sha256: "b".repeat(64) }],
  };
}

function routing(activity: string[]): Routing {
  return { text: async () => { activity.push("decision"); return { actionId: "delete", confidence: 0.1, calls: [] }; }, experimentalImages: false, minConfidence: 0.65 };
}

describe("assertion-only QA runner", () => {
  it("waits through a cold load and records verified evidence without model decisions or controls", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const activity: string[] = [];
    const pending = runQa(scenario(), driver(() => Date.now() - start >= 30_000, activity), routing(activity), { assertionWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(31_000);
    const receipt = await pending;
    expect(receipt).toMatchObject({ status: "passed", goals: [{ id: "result", passed: true, actual: "Ready" }], steps: [] });
    expect(receipt.artifacts.some((artifact) => artifact.kind === "video")).toBe(true);
    expect(activity).toEqual([]);
  });

  it("fails after the bounded wait when assertions never pass", async () => {
    vi.useFakeTimers();
    const activity: string[] = [];
    const pending = runQa(scenario(), driver(() => false, activity), routing(activity), { assertionWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await pending).toMatchObject({ status: "failed", stopReason: "assertion-wait-budget", goals: [{ passed: false }], steps: [] });
    expect(activity).toEqual([]);
  });

  it("does not pass after cancellation, including during receipt persistence", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runQa(scenario(), driver(() => true, []), routing([]), { assertionWaitMs: 60_000, signal: controller.signal, onAssertion: async () => { controller.abort(); } });
    expect(await pending).toMatchObject({ status: "cancelled", stopReason: "cancelled" });
  });

  it("interrupts a pending assertion wait on cancellation", async () => {
    const controller = new AbortController();
    const pending = runQa(scenario(), driver(() => false, []), routing([]), { assertionWaitMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 25);
    expect(await pending).toMatchObject({ status: "cancelled", stopReason: "cancelled", goals: [{ passed: false }] });
  });

  it("honors the task deadline before the assertion budget", async () => {
    const short = { ...scenario(), maxDurationMs: 150 };
    const result = await runQa(short, driver(() => false, []), routing([]), { assertionWaitMs: 60_000 });
    expect(result).toMatchObject({ status: "blocked", stopReason: "time-budget", goals: [{ passed: false }] });
  });

  it("never accepts a low-confidence interactive action in the manual runner", async () => {
    const activity: string[] = [];
    const result = await runQa(scenario(), driver(() => false, activity), routing(activity));
    expect(result.status).toBe("blocked");
    expect(activity).toContain("decision");
    expect(activity).not.toContain("act");
  });
});

describe("QA security and evidence boundaries", () => {
  it("does not expose legacy preview output through the task summary", () => {
    const secret = "synthetic-preview-secret";
    const reason = `The preview command exited (code 2). Last output: ${secret}`;
    const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
    record.auto = newAutoState("http://localhost");
    record.auto.phase = "ready";
    record.auto.preview = { state: "none", reason };
    record.auto.verify = { reviewDone: true, qaSkipped: `No preview: ${reason}` };
    record.auto.baselineIssue = `Before capture incomplete: No preview: ${reason} Capture it manually against the base checkout.`;
    record.lastError = `Auto mode finished. QA didn't run (No preview: ${reason}).`;
    expect(JSON.stringify(summariseOrchestration(record))).not.toContain(secret);
    expect(JSON.stringify(record)).toContain(secret);
  });

  it.each([
    "The isolated static preview is running.",
    "The managed preview changed or stopped. Retry QA.",
    "Automatic QA requires an isolated static preview. Command-based previews cannot prove connection ownership.",
    "Static previews require a directory and cannot specify a command or port.",
    "No checkout to serve the static preview from.",
    "The static preview directory must exist inside the checkout.",
    "Starting the isolated static preview.",
    "The managed preview was stopped before it could start.",
    "The isolated static preview could not bind a local listener.",
  ])("keeps the safe current preview reason in the task summary: %s", (reason) => {
    const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
    record.auto = newAutoState("http://localhost");
    record.auto.preview = { state: "none", reason };
    record.auto.verify = { reviewDone: true, qaSkipped: `No preview: ${reason}` };
    record.auto.baselineIssue = `Before capture incomplete: No preview: ${reason} Capture it manually against the base checkout.`;
    record.lastError = `Auto mode finished. QA didn't run (No preview: ${reason}).`;
    const summary = summariseOrchestration(record);
    expect(summary.lastError).toContain(reason);
    expect(summary.auto?.preview?.reason).toBe(reason);
    expect(summary.auto?.qaSkipped).toContain(reason);
    expect(summary.auto?.baselineIssue).toContain(reason);
  });

  it("keeps command configuration secrets out of the fail-closed reason", async () => {
    const secret = "SYNTHETIC_PREVIEW_SECRET";
    const upstarts = path.join(dir, "upstarts");
    fs.mkdirSync(path.join(upstarts, "repo"), { recursive: true });
    fs.writeFileSync(path.join(upstarts, "repo", "preview.json"), JSON.stringify({ autoStart: true, kind: "dev", command: `echo ${secret}` }));
    vi.stubEnv("UPSTARTS_DIR", upstarts);
    const result = await ensurePreview({ taskId: task.id, repoName: "repo", cwd: dir });
    expect(result).toMatchObject({ state: "none", url: null, reason: expect.stringContaining("Command-based previews") });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(listPreviews().some((preview) => preview.taskId === task.id)).toBe(false);
  });

  it.each(["setup", "initial capture", "assertions", "observation", "action", "model", "progress", "final capture", "cleanup"] as const)("sanitizes %s exceptions in the shipped runner", async (stage) => {
    const secret = "SYNTHETIC_RUNNER_SECRET";
    const passed = stage === "final capture" || stage === "cleanup";
    const fake = driver(() => passed, []);
    if (stage === "setup") fake.start = async () => { throw new Error(secret); };
    if (stage === "initial capture" || stage === "final capture") {
      const capture = fake.capture;
      fake.capture = async (phase) => {
        if ((stage === "initial capture" && phase === "before") || (stage === "final capture" && phase === "after")) throw new Error(secret);
        return capture(phase);
      };
    }
    if (stage === "assertions") fake.assert = async () => { throw new Error(secret); };
    if (stage === "observation") fake.observe = async () => { throw new Error(secret); };
    if (stage === "action") fake.act = async () => { throw new Error(secret); };
    if (stage === "cleanup") fake.close = async () => { throw new Error(secret); };
    const call: ModelUsage = { provider: "typesafe", model: "jev", inputTokens: null, outputTokens: null, costUsd: null, costBasis: "unavailable", durationMs: 1, error: secret };
    const policy: Routing = { text: async () => {
      if (stage === "model") throw new DecisionError(secret, [call]);
      return { actionId: "delete", confidence: 1, calls: [] };
    }, experimentalImages: false, minConfidence: 0.65 };
    const receipt = await runQa({ ...scenario(), maxSteps: 1 }, fake, policy, {
      ...(stage === "progress" ? { onStep: async () => { throw new Error(secret); } } : {}),
    });
    expect(receipt.status).not.toBe("passed");
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(receipt.errors.length || receipt.steps.some((step) => step.error)).toBeTruthy();
  });

  it("sanitizes TypeSafe transport errors and honors bounded cancellation", async () => {
    const secret = "SYNTHETIC_TRANSPORT_SECRET";
    const input = { goal: "Wait", observation: { text: "Preview", fingerprint: "preview", actions: [{ id: "wait", description: "Wait", kind: "wait" as const }] }, history: [] };
    const policy = jevPolicy({ apiKey: () => "test-key", timeoutMs: 120_000, fetch: async () => { throw new Error(`TypeSafe ${secret}`); } });
    const error: unknown = await policy({ ...input, signal: new AbortController().signal }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ message: "TypeSafe request failed or timed out." });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(() => jevPolicy({ apiKey: () => "test-key", timeoutMs: 120_001 })).toThrow();
    const controller = new AbortController();
    const pending = jevPolicy({ apiKey: () => "test-key", timeoutMs: 120_000, fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal || signal.aborted) { reject(new Error("aborted")); return; }
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) })({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ message: "Decision cancelled." });
  });

  it("keeps DOM, expectations and exceptions local when attaching a failure and composing an automatic fix", async () => {
    const secret = "SYNTHETIC_PRIVATE_DOM";
    await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: "2026-10-26" }), dir);
    const id = randomUUID();
    const run = { id, requestId: id, scenarioId: "fixture", taskId: task.id, createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = interruptedReceipt(run);
    receipt.title = secret; receipt.status = "failed"; receipt.stopReason = secret; receipt.errors = [secret];
    receipt.goals = [{ id: "result", description: secret, passed: false, actual: secret }];
    writeRun({ ...run, receipt }, dir);
    await attachVerification(task.id, receipt, dir);
    const result = await autoDeps({ dispatch: async () => { throw new Error("not used"); }, resolveRepos: async () => [], findTask: async () => null }, dir).qaResult(id);
    const prompt = buildAutoFixPrompt({ taskId: task.id, date: "2026-10-26", origin: "http://127.0.0.1:49152", round: 1, maxRounds: 2, findings: [...(result?.failing ?? []).map((item) => `QA: ${item}`), `QA: old finding ${secret}`] });
    const orchestration = readOrchestration(task.id, dir);
    expect(result?.failing).toEqual(["Assertion 1 failed", "Runner reported 1 error"]);
    expect(orchestration).toMatchObject({ status: "needs-you", questions: [{ prompt: expect.stringContaining("Assertion 1 failed") }] });
    expect(JSON.stringify({ result, prompt, lastError: orchestration?.lastError, questions: orchestration?.questions })).not.toContain(secret);
    expect(listRuns(dir)[0].receipt?.goals[0].actual).toBe(secret);
  });

  it("does not present a provisional receipt or a previous pass as the latest result", async () => {
    const id = randomUUID();
    const old = { id, requestId: id, scenarioId: "fixture", taskId: task.id, createdAt: "2026-10-25T00:00:00.000Z", state: "finished" as const };
    const receipt = interruptedReceipt(old);
    receipt.status = "passed"; receipt.goals = [{ id: "result", description: "Result", passed: true, actual: "Ready" }];
    receipt.artifacts = [{ file: "old.png", kind: "image", phase: "after", sha256: "a".repeat(64) }];
    const runningId = randomUUID();
    const running = { ...old, id: runningId, requestId: runningId, createdAt: "2026-10-26T00:00:00.000Z", state: "running" as const, receipt: { ...receipt, id: runningId, status: "failed" as const, endedAt: "" } };
    expect(jevInfoByTask([{ ...old, receipt }, running]).get(task.id)).toMatchObject({ runId: runningId, status: "running", bugCount: 0, screenshot: null });
    const record = newOrchestration({ taskId: task.id, taskDate: "2026-10-26" });
    record.auto = newAutoState("http://127.0.0.1:49152"); record.auto.phase = "ready"; record.auto.verify = { qaSkipped: "QA skipped: no preview." }; record.status = "ready-for-review";
    const fullTask: Task = { ...task, done: false, startDate: "2026-10-26", createdAt: "", rank: "a" };
    const board = () => buildNotesBoard({ tasks: [fullTask], now: Date.now(), doneWindowDays: null, noteFor: () => ({ notePath: "task-notes/example", view: null, modified: null }), runsFor: () => [], orchestrations: new Map([[task.id, summariseOrchestration(record)]]), jev: jevInfoByTask([{ ...old, receipt }]), errors: [] });
    expect(board().cards[0]).toMatchObject({ jev: null, screenshot: null });
    record.auto = undefined; record.executionStep = "verify"; record.status = "paused"; record.lastError = "QA skipped: no preview.";
    expect(board().cards[0]).toMatchObject({ jev: null, screenshot: null });
    expect(jevInfoByTask([{ ...old, receipt }]).get(task.id)?.runId).toBe(id);

    const { url, stop } = await managedPreview();
    try {
      record.auto = newAutoState("http://127.0.0.1:49152"); record.auto.phase = "verify";
      record.auto.preview = { state: "started", url, reason: "The managed preview is running." }; record.status = "running";
      expect(board().cards[0].auto?.previewUrl).toBe(url);
    } finally {
      await stop();
    }
    expect(board().cards[0].auto?.previewUrl).toBeUndefined();
  });
});
