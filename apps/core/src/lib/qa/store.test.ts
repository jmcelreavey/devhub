import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const qaRunner = vi.hoisted(() => vi.fn());
vi.mock("@devhub/qa", async (original) => ({ ...await original<typeof import("@devhub/qa")>(), runQa: qaRunner }));
vi.mock("@devhub/qa/browser", () => ({ BrowserDriver: class BrowserDriver {} }));
import { randomUUID } from "node:crypto";
import { artifactPath, listRuns, listScenarios, readRun, readSettings, runDir, saveScenario, saveSettings, writeRun } from "./store";
import { claimQaLease } from "./lease";
import { ScenarioSchema } from "./schema";
import { prepareQaRun, prepareTaskQaRun, attachVerification, buildTaskQaScenario, qaRunsWithRecovery, taskQaTargetUrl, cancelQaRun, activeQaJobCount } from "./service";
import { mutateOrchestration, newOrchestration, readOrchestration, deleteOrchestration } from "../storyboard/orchestration-store";
import { ensurePreview, stopPreview } from "../storyboard/preview";
import { jevInfoByTask } from "../../../../../packages/shared/ui-lib/qa/jev-summary";
import { interruptedReceipt } from "./interrupted-receipt";
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-store-")); qaRunner.mockReset(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
describe("QA storage and orchestration", () => {
  it("retains an automatic task run and video for the task Evidence link", async () => {
    const taskId = "automatic-qa-task";
    const previousUpstartsDir = process.env.UPSTARTS_DIR;
    process.env.UPSTARTS_DIR = path.join(dir, "upstarts");
    const configDir = path.join(process.env.UPSTARTS_DIR, "fixture");
    const checkout = path.join(dir, "checkout");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(checkout, "site"), { recursive: true });
    fs.writeFileSync(path.join(configDir, "preview.json"), JSON.stringify({ autoStart: true, kind: "static", directory: "site" }));
    fs.writeFileSync(path.join(checkout, "site", "index.html"), "<h1>Saved</h1>");
    try {
      await mutateOrchestration(taskId, null, () => ({
        ...newOrchestration({ taskId, taskDate: "2026-10-19" }),
        status: "running" as const,
        auto: { cycleId: randomUUID(), phase: "verify" as const, round: 0, maxRounds: 3, attempt: 0, origin: "http://localhost:1437", runs: [] },
      }), dir);
      const preview = await ensurePreview({ taskId, repoName: "fixture", cwd: checkout });
      if (!preview.url) throw new Error(preview.reason);
      const declaration = { goals: [{ assertion: "text", selector: "h1", expected: "Saved", description: "Saved is visible" }] };
      const prepared = prepareTaskQaRun({ task: { id: taskId, text: "Show Saved", links: [] }, sourceRunId: "auto-run", targetUrl: preview.url, noteMarkdown: `## Verification\n\`\`\`devhub-qa\n${JSON.stringify(declaration)}\n\`\`\`` }, dir);
      if (prepared.skipped || !prepared.execute) throw new Error("Expected an automatic QA run");
      qaRunner.mockImplementation(async () => {
        const receipt = interruptedReceipt(prepared.run);
        receipt.status = "passed";
        receipt.goals = [{ id: "goal-1", description: "Saved is visible", passed: true, actual: "Saved" }];
        receipt.artifacts = [{ file: "run.webm", kind: "video", phase: "after", sha256: "a".repeat(64) }];
        fs.writeFileSync(path.join(runDir(prepared.run.id, dir), "run.webm"), "fixture video");
        return receipt;
      });
      await prepared.execute();
      expect(readRun(prepared.run.id, dir)).toMatchObject({ taskId, state: "finished", receipt: { status: "passed" } });
      expect(artifactPath(prepared.run.id, "run.webm", dir)).toBe(fs.realpathSync(path.join(runDir(prepared.run.id, dir), "run.webm")));
      expect(jevInfoByTask(listRuns(dir)).get(taskId)).toMatchObject({
        runId: prepared.run.id,
        receiptHref: `/qa?run=${prepared.run.id}&task=${taskId}`,
        afterVideo: `/api/qa/runs/${prepared.run.id}/media/run.webm`,
      });
    } finally {
      stopPreview(taskId);
      if (previousUpstartsDir === undefined) delete process.env.UPSTARTS_DIR;
      else process.env.UPSTARTS_DIR = previousUpstartsDir;
    }
  });
  it("defaults image experiments off and stores validated routing", () => {
    expect(readSettings(dir).experimentalImages).toBe(false);
    saveSettings({ experimentalImages: true, minConfidence: 0.8, visionModel: "", visionEffort: "" }, dir);
    expect(readSettings(dir).minConfidence).toBe(0.8);
  });
  it("allows only receipt-listed media and rejects a symlink outside the run", () => {
    const id = randomUUID();
    const row = { id, requestId: id, scenarioId: "x", createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = interruptedReceipt(row);
    receipt.artifacts = [{ file: "after.png", kind: "image", phase: "after", sha256: "a".repeat(64) }];
    writeRun({ ...row, receipt }, dir);
    const outside = path.join(dir, "private.png");
    fs.writeFileSync(outside, "private");
    fs.symlinkSync(outside, path.join(runDir(id, dir), "after.png"));
    expect(artifactPath(id, "after.png", dir)).toBeNull();
    expect(artifactPath(id, "../private.png", dir)).toBeNull();
    expect(listRuns(dir)).toHaveLength(1);
  });
  it("holds one lease across dashboard processes and releases only its own", () => {
    const release = claimQaLease("first", dir);
    expect(() => claimQaLease("second", dir)).toThrow("already owns");
    release();
    claimQaLease("second", dir)();
  });
  it("replays an existing request without starting another browser", () => {
    const id = randomUUID(), requestId = randomUUID();
    writeRun({ id, requestId, scenarioId: "smoke", createdAt: new Date().toISOString(), state: "finished" }, dir);
    expect(prepareQaRun({ scenarioId: "smoke", requestId }, dir)).toMatchObject({ run: { id } });
    expect(prepareQaRun({ scenarioId: "smoke", requestId }, dir).execute).toBeUndefined();
    expect(() => prepareQaRun({ scenarioId: "other", requestId }, dir)).toThrow("another run");
  });
  it("turns failed QA into Needs you, resolves it on a passing rerun, and respects Manual", async () => {
    const taskId = "qa-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-16" }), dir);
    const row = { id: randomUUID(), requestId: randomUUID(), scenarioId: "smoke", taskId, createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = interruptedReceipt(row);
    writeRun({ ...row, receipt }, dir);
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.status).toBe("needs-you");
    receipt.status = "passed";
    receipt.goals = [{ id: "outcome", description: "Outcome verified", passed: true, actual: "Visible" }];
    writeRun({ ...row, receipt }, dir);
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.questions[0].state).toBe("answered");
    await mutateOrchestration(taskId, null, current => ({ ...current!, status: "paused-manual" }), dir);
    receipt.status = "failed";
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.status).toBe("paused-manual");
  });
  it.each([true, false])("does not attach an empty passed receipt as success (persisted=%s)", async (persisted) => {
    const taskId = "unverified-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-16" }), dir);
    const row = { id: randomUUID(), requestId: randomUUID(), scenarioId: "smoke", taskId, createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = interruptedReceipt(row);
    receipt.status = "passed";
    receipt.goals = [];
    if (persisted) writeRun({ ...row, receipt }, dir);
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)).toMatchObject({ status: "needs-you", lastError: expect.stringContaining(persisted ? "no verified goals" : "receipt is missing") });
  });
  it.each(["missing run", "missing receipt", "running", "blocked", "cancelled"] as const)("does not attach a passed copy over %s recorded evidence", async (outcome) => {
    const taskId = "missing-evidence-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-16" }), dir);
    const row = { id: randomUUID(), requestId: randomUUID(), scenarioId: "smoke", taskId, createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = { ...interruptedReceipt(row), status: "passed" as const, goals: [{ id: "outcome", description: "Outcome", passed: true, actual: "Visible" }] };
    if (outcome !== "missing run") writeRun({ ...row, state: outcome === "running" ? "running" : "finished", ...(outcome === "missing receipt" ? {} : { receipt: { ...receipt, status: outcome === "blocked" || outcome === "cancelled" ? outcome : "passed" } }) }, dir);
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.status).toBe("needs-you");
  });
  it("recovers an interrupted run into a task blocker after restart", async () => {
    const taskId = "interrupted-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-16" }), dir);
    writeRun({ id: randomUUID(), requestId: randomUUID(), taskId, scenarioId: "smoke", createdAt: new Date().toISOString(), state: "running", ownerPid: 2147483647 }, dir);
    const [recovered] = await qaRunsWithRecovery(dir);
    expect(recovered.receipt?.status).toBe("blocked");
    expect(readOrchestration(taskId, dir)?.status).toBe("needs-you");
    await qaRunsWithRecovery(dir);
    expect(readOrchestration(taskId, dir)?.questions).toHaveLength(1);
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])("does not start stale QA against a recreated orchestration (baseline=%s, cancel=%s)", async (baseline, cancel) => {
    const taskId = "reset-task";
    const createdAt = "2026-10-19T10:00:00.000Z";
    const create = () => ({
      ...newOrchestration({ taskId, taskDate: "2026-10-19" }, createdAt),
      auto: { cycleId: randomUUID(), phase: "verify" as const, round: 0, maxRounds: 3, attempt: 0, origin: "http://localhost:1349", runs: [] },
    });
    await mutateOrchestration(taskId, null, create, dir);
    saveScenario(ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:4173", goals: [{ id: "result", description: "Result", assertion: "text", selector: "body", expected: "Success" }] }), dir);
    const prepared = prepareQaRun({ taskId, scenarioId: "smoke", requestId: randomUUID(), baseline }, dir);
    if (cancel) cancelQaRun(prepared.run.id);
    await deleteOrchestration(taskId, dir);
    const replacement = (await mutateOrchestration(taskId, null, create, dir)).record;
    await prepared.execute!();
    expect(qaRunner).not.toHaveBeenCalled();
    expect(readOrchestration(taskId, dir)).toEqual(replacement);
    expect(listRuns(dir)[0]).toMatchObject({ state: "finished", receipt: { status: "blocked" } });
    expect(activeQaJobCount()).toBe(0);
  });
  it("stops an in-flight QA callback from changing a new task cycle", async () => {
    const taskId = "in-flight-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-19" }, "2026-10-19T10:00:00.000Z"), dir);
    saveScenario(ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:4173", goals: [{ id: "result", description: "Result", assertion: "text", selector: "body", expected: "Success" }] }), dir);
    const prepared = prepareQaRun({ taskId, scenarioId: "smoke", requestId: randomUUID() }, dir);
    const receipt = interruptedReceipt(prepared.run);
    receipt.status = "passed";
    let replacement: ReturnType<typeof readOrchestration> = null;
    qaRunner.mockImplementation(async (_scenario, _driver, _routing, options) => {
      expect(readOrchestration(taskId, dir)?.status).toBe("running");
      await deleteOrchestration(taskId, dir);
      replacement = (await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-19" }, "2026-10-19T11:00:00.000Z"), dir)).record;
      await options.onStep(undefined, receipt);
      expect(options.signal.aborted).toBe(true);
      return receipt;
    });
    await prepared.execute!();
    expect(qaRunner).toHaveBeenCalledOnce();
    expect(readOrchestration(taskId, dir)).toEqual(replacement);
    expect(activeQaJobCount()).toBe(0);
  });
  it("ignores late QA receipts after reset, including recovery without the old identity", async () => {
    const taskId = "late-task";
    await mutateOrchestration(taskId, null, () => newOrchestration({ taskId, taskDate: "2026-10-19" }, "2026-10-19T11:00:00.000Z"), dir);
    const replacement = readOrchestration(taskId, dir);
    for (const orchestrationId of ["2026-10-19T10:00:00.000Z", undefined]) {
      const row = { id: randomUUID(), requestId: randomUUID(), scenarioId: "smoke", taskId, orchestrationId, createdAt: "2026-10-19T10:01:00.000Z", state: "finished" as const };
      const receipt = interruptedReceipt(row);
      writeRun({ ...row, receipt }, dir);
      await attachVerification(taskId, receipt, dir);
      expect(readOrchestration(taskId, dir)).toEqual(replacement);
    }
    await deleteOrchestration(taskId, dir);
    await expect(attachVerification(taskId, listRuns(dir)[0].receipt!, dir)).resolves.toBeUndefined();
    expect(readOrchestration(taskId, dir)).toBeNull();
  });
  it("rejects unsupported targets and empty assertions before saving", () => {
    const raw = { id: "test", title: "Test", surface: "dom", url: "http://localhost:3000", goals: [{ id: "result", description: "Result", assertion: "text" }] };
    expect(() => saveScenario(ScenarioSchema.parse(raw), dir)).toThrow();
  });
  it("requires a saved deterministic scenario instead of treating task prose as page text", () => {
    const task = { id: "task-one", text: "Saved articles work offline", links: [] };
    const noteMarkdown = "## Acceptance\n- The saved article remains visible offline.\n\n## Preview\nhttp://localhost:4173/articles/saved";
    expect(buildTaskQaScenario({ task, noteMarkdown }, listScenarios(dir))).toMatchObject({ reason: expect.stringContaining("QA scenario:") });
    expect(listScenarios(dir)).toEqual([]);
    expect(listRuns(dir)).toEqual([]);
  });
  it("does not discover arbitrary page actions for a task scenario without an explicit action menu", () => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const scenario = ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "saved", description: "Article", assertion: "text", expected: "Saved" }] });
    const built = buildTaskQaScenario({ task, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\nQA scenario: smoke" }, [scenario]);
    expect(built).toMatchObject({ reason: expect.stringContaining("wait-only") });
    expect(scenario.actions).toBeUndefined();
  });
  it("ignores scenario references inside fenced examples", () => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const scenario = ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "saved", description: "Article", assertion: "text", expected: "Saved" }] });
    const input = { task, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\n````text\n```\nQA scenario: smoke\n```\n````" };
    expect(buildTaskQaScenario(input, [scenario])).toMatchObject({ reason: expect.stringContaining("QA scenario:") });
  });
  it.each([
    "````text\n## Verification\nQA scenario: smoke\n````",
    "## Verification\n    QA scenario: smoke",
    "## Verification\n<!--\nQA scenario: smoke\n-->",
  ])("does not treat inactive note text as a QA opt-in (%s)", (noteMarkdown) => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const scenario = ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "saved", description: "Article", assertion: "text", expected: "Saved" }] });
    expect(buildTaskQaScenario({ task, targetUrl: "http://localhost:4173", noteMarkdown }, [scenario])).toMatchObject({ reason: expect.stringContaining("QA scenario:") });
  });
  it("does not confuse a scenario ID with another scenario's title", () => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const first = ScenarioSchema.parse({ id: "smoke", title: "Other", surface: "dom", url: "http://localhost:3000", goals: [{ id: "saved", description: "Article", assertion: "text", expected: "Saved" }], actions: [{ id: "wait", description: "Wait", kind: "wait" }] });
    const second = { ...first, id: "other", title: "smoke" };
    const input = { task, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\nQA scenario: smoke" };
    expect(buildTaskQaScenario(input, [first, second])).toMatchObject({ reason: expect.stringContaining("ambiguous") });
    expect(buildTaskQaScenario({ ...input, noteMarkdown: "## Verification\nQA scenario: id:smoke" }, [first, second])).toMatchObject({ scenario: { id: "smoke" } });
  });
  it("does not offer a selectorless or unsupported action in task QA", () => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const scenario = ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "saved", description: "Article", assertion: "text", expected: "Saved" }], actions: [{ id: "click", kind: "click", description: "Click" }] });
    const input = { task, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\nQA scenario: smoke" };
    expect(buildTaskQaScenario(input, [scenario])).toMatchObject({ reason: expect.stringContaining("interactive") });
  });
  it("skips ambiguous or non-outcome scenarios rather than claiming task QA passed", () => {
    const task = { id: "task-one", text: "Check saved articles", links: [] };
    const base = { title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "errors", description: "No errors", assertion: "no-errors" }], actions: [{ id: "wait", description: "Wait", kind: "wait" }] };
    const scenario = ScenarioSchema.parse({ ...base, id: "smoke" });
    const input = { task, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\nQA scenario: Smoke" };
    expect(buildTaskQaScenario(input, [scenario])).toMatchObject({ reason: expect.stringContaining("outcome") });
    expect(buildTaskQaScenario(input, [scenario, { ...scenario, id: "smoke2" }])).toMatchObject({ reason: expect.stringContaining("ambiguous") });
  });
  it.each([
    { assertion: "text", expected: " " },
    { assertion: "visible", selector: "HTML" },
  ])("does not count a trivial assertion as a task outcome", (goal) => {
    const scenario = ScenarioSchema.parse({ id: "smoke", title: "Smoke", surface: "dom", url: "http://localhost:3000", goals: [{ id: "outcome", description: "Outcome", ...goal }], actions: [{ id: "wait", description: "Wait", kind: "wait" }] });
    const input = { task: { id: "task-one", text: "Check saved articles", links: [] }, targetUrl: "http://localhost:4173", noteMarkdown: "## Verification\nQA scenario: smoke" };
    expect(buildTaskQaScenario(input, [scenario])).toMatchObject({ reason: expect.stringContaining("outcome") });
  });
  it.each(["github.com/org/app", "gitlab.com/org/app", "bitbucket.org/org/app", "team.atlassian.net/browse/DEV-1"])("ignores %s and keeps looking for a runnable target", (reference) => {
    expect(taskQaTargetUrl({ links: [] }, `App: https://${reference}\nPreview: http://localhost:4173/app`)).toBe("http://localhost:4173/app");
    expect(taskQaTargetUrl({ links: [] }, `App: https://${reference}\n## Preview\nhttps://${reference}\nhttp://localhost:4173/app`)).toBe("http://localhost:4173/app");
    expect(taskQaTargetUrl({ links: [] }, `[App](https://${reference})`)).toBeNull();
  });
  it("does not reject an application whose hostname only ends with the Atlassian name", () => {
    expect(taskQaTargetUrl({ links: [] }, "Preview: https://notatlassian.net")).toBe("https://notatlassian.net/");
  });
  it("requires an explicitly labelled runnable target", () => {
    const task = { links: [{ kind: "repo" as const, id: "org/app", label: "app", href: "https://github.com/org/app" }] };
    expect(taskQaTargetUrl(task, "## Links\n\n[Plan](https://example.com/plan)")).toBeNull();
    expect(taskQaTargetUrl({ links: [] }, "Preview URL: https://preview.example.com/build/42")).toBe("https://preview.example.com/build/42");
  });
});
