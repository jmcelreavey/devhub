import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const qaRunner = vi.hoisted(() => vi.fn());
vi.mock("@devhub/qa", async (original) => ({ ...await original<typeof import("@devhub/qa")>(), runQa: qaRunner }));
vi.mock("@devhub/qa/browser", () => ({ BrowserDriver: class BrowserDriver {} }));
import { randomUUID } from "node:crypto";
import { artifactPath, listRuns, readSettings, runDir, saveScenario, saveSettings, writeRun } from "./store";
import { claimQaLease } from "./lease";
import { ScenarioSchema } from "./schema";
import { prepareQaRun, attachVerification, buildTaskQaScenario, qaRunsWithRecovery, taskQaTargetUrl, cancelQaRun, activeQaJobCount } from "./service";
import { mutateOrchestration, newOrchestration, readOrchestration, deleteOrchestration } from "@/lib/storyboard/orchestration-store";
import { interruptedReceipt } from "./interrupted-receipt";
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-store-")); qaRunner.mockReset(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
describe("QA storage and orchestration", () => {
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
    const row = { id: randomUUID(), requestId: randomUUID(), scenarioId: "smoke", createdAt: new Date().toISOString(), state: "finished" as const };
    const receipt = interruptedReceipt(row);
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.status).toBe("needs-you");
    receipt.status = "passed";
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.questions[0].state).toBe("answered");
    await mutateOrchestration(taskId, null, current => ({ ...current!, status: "paused-manual" }), dir);
    receipt.status = "failed";
    await attachVerification(taskId, receipt, dir);
    expect(readOrchestration(taskId, dir)?.status).toBe("paused-manual");
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
  it("builds an automatic Jev scenario from the task title, description, acceptance, and preview URL", () => {
    const task = { id: "task-one", text: "Saved articles work offline", links: [{ kind: "repo" as const, id: "org/app", label: "app" }] };
    const noteMarkdown = [
      "## Description", "", "Let readers save an article before losing their connection.", "",
      "## Acceptance criteria", "", "- The saved article remains visible offline.", "",
      "## Preview", "", "http://localhost:4173/articles/saved",
    ].join("\n");
    const scenario = buildTaskQaScenario({ task, noteMarkdown });
    expect(scenario).toMatchObject({
      id: "storyboard-task-one",
      url: "http://localhost:4173/articles/saved",
      goals: [
        { id: "title", description: "Saved articles work offline" },
        { id: "description", description: "Let readers save an article before losing their connection." },
        { id: "acceptance", description: "The saved article remains visible offline." },
      ],
    });
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
