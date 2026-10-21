import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/paseo/client", () => ({ withPaseo: vi.fn(), openPaseoSession: vi.fn(), paseoUrl: vi.fn() }));

import { AgentDispatchError } from "@/lib/agent-runs/dispatch";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { Task } from "@/lib/tasks/types";
import { upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import { mutateOrchestration, newOrchestration, readOrchestration } from "./orchestration-store";
import { answerRepoQuestion, chooseCheckoutMode, planScope, reconcileOrchestration, replaceRepoLink, resetTaskToTodo, setOrchestrationMode, startOrchestration, taskRiskReason, type OrchestratorDeps } from "./orchestrator";
import type { OrchestrateStartInput } from "./schema";
import { StoryboardError } from "./errors";
import { DEFAULT_MODEL_TIERS } from "./model-tiers-shared";

const TASK_ID = "11111111-2222-3333-4444-555555555555";
let root: string;
let notes: string;
let savedProjects: string | undefined;
let keyCounter = 0;
const key = () => `start-key-${String(++keyCounter).padStart(6, "0")}`;

function task(patch: Partial<Task> = {}): Task {
  return { id: TASK_ID, text: "Show saved articles offline", done: false, createdAt: "", startDate: "2026-10-15", rank: "a", links: [{ kind: "repo", id: "org/app", label: "app" }], ...patch } as Task;
}

function deps(current: Task | null = task(), patch: Partial<OrchestratorDeps> = {}) {
  const dispatch = vi.fn(async () => ({ spec: { id: "run-orch0001-0000000a" } }) as unknown as AgentRun);
  return {
    dispatch,
    resolveRepos: vi.fn(async () => [{ fullName: "org/app", repo: { name: "app", path: path.join(root, "app") } }]) as unknown as OrchestratorDeps["resolveRepos"],
    findTask: vi.fn(async () => current),
    inspectCheckout: vi.fn(async () => ({ dirty: false, activeRuns: 0 })),
    cancelRun: vi.fn(async () => "signalled"),
    // Without this the real capacity probe counts agents running on the machine, and two live runs queue every start.
    activeHeavyJobs: () => 0,
    linkRepo: vi.fn(async () => undefined),
    validateCwd: vi.fn((cwd: string) => cwd),
    readPlanNote: vi.fn(() => null),
    ...patch,
  } satisfies OrchestratorDeps;
}

const input = (patch: Partial<OrchestrateStartInput> = {}): OrchestrateStartInput => ({ action: "start", taskId: TASK_ID, taskDate: "2026-10-15", idempotencyKey: key(), ...patch });
const start = (d: OrchestratorDeps, i = input()) => startOrchestration(i, { origin: "http://localhost:1337" }, d, notes);

/** A record from before auto mode (no `auto`): the legacy implement → QA hand-off still applies to it. */
async function finishedImplementation(d: OrchestratorDeps): Promise<void> {
  await start(d);
  await mutateOrchestration(TASK_ID, null, (current) => { const next = { ...current!, executionStep: "implement" as const, status: "running" as const }; delete next.auto; return next; }, notes);
  await upsertTaskAgentRun({
    taskId: TASK_ID,
    runId: "run-orch0001-0000000a",
    role: "implement",
    status: "done",
    notesDir: notes,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-orchestrator-"));
  notes = path.join(root, "notes");
  fs.mkdirSync(notes, { recursive: true });
  savedProjects = process.env.DEVHUB_PROJECTS_FILE;
  process.env.DEVHUB_PROJECTS_FILE = path.join(root, "projects.json");
  fs.writeFileSync(process.env.DEVHUB_PROJECTS_FILE, JSON.stringify([{ label: "App", repos: ["app"] }]));
});
afterEach(() => {
  if (savedProjects === undefined) delete process.env.DEVHUB_PROJECTS_FILE;
  else process.env.DEVHUB_PROJECTS_FILE = savedProjects;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Start on auto", () => {
  it.each([undefined, "", "low"])("dispatches the initial plan with tier effort unless the sheet overrides it (%s)", async (effort) => {
    const dependencies = deps();
    const tiers = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, mid: { provider: "codex", model: "gpt-6", effort: "high" } } };
    const result = await start(dependencies, input({ tiers, stepOverrides: { plan: { provider: "codex", model: "gpt-6-sol", effort } } }));
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0]).toMatchObject({ provider: "codex", model: "gpt-6-sol", effort: effort || "high" });
    expect(result.orchestration.tiers).toEqual(tiers);
    expect(readOrchestration(TASK_ID, notes)?.tiers).toEqual(tiers);
  });

  it("persists launch settings and applies them to the initial plan and a dispatch retry", async () => {
    const dependencies = deps();
    const choice = { provider: "codex", model: "gpt-6-sol", effort: "high" };
    const options = { stepOverrides: { plan: choice, implement: choice, review: { provider: "claude", model: "opus", effort: "max" } }, instructions: "Keep compatibility", worktree: true };
    vi.mocked(dependencies.dispatch).mockRejectedValueOnce(new Error("Paseo unavailable"));
    await start(dependencies, input({ ...options, pauseAfterPlan: true }));
    expect(readOrchestration(TASK_ID, notes)).toMatchObject({ launchOptions: options, auto: { pauseAfterPlan: true } });
    const second = await start(dependencies);
    expect(second.runId).toBeTruthy();
    for (const [run] of vi.mocked(dependencies.dispatch).mock.calls) {
      expect(run).toMatchObject({ ...choice, worktree: true, activity: { action: "plan" } });
      expect(run.prompt).toContain("Keep compatibility");
      expect(run.prompt).toContain("Plan");
    }
  });

  it("prepares the shared checkout before Auto planning when isolation is disabled", async () => {
    const dependencies = deps();
    dependencies.inspectCheckout = async () => ({ dirty: true, activeRuns: 0 });
    await start(dependencies, input({ worktree: false }));
    expect(dependencies.dispatch).toHaveBeenCalledWith(expect.objectContaining({ worktree: false, prepareCheckout: true, activity: { source: "interactive", action: "plan", taskId: TASK_ID, taskDate: expect.any(String), repoName: expect.any(String) } }), { defer: true });
  });

  it("retains launch settings while waiting for a repo", async () => {
    const dependencies = deps(task({ links: [] }));
    const result = await start(dependencies, input({ instructions: "Keep the CLI stable", worktree: false }));
    expect(result.orchestration).toMatchObject({ status: "needs-you", launchOptions: { instructions: "Keep the CLI stable", worktree: false } });
    expect(dependencies.dispatch).not.toHaveBeenCalled();
  });

  it("leaves old starts without launch overrides", async () => {
    const dependencies = deps();
    const result = await start(dependencies);
    expect(result.orchestration.launchOptions).toBeUndefined();
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0].effort).toBeUndefined();
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0].worktree).toBe(false);
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0].prompt).not.toContain("Additional instructions from the user:");
  });
  it("refuses new runs and skips reconciliation for an unconfirmed pickup", async () => {
    const current = task();
    const dependencies = deps(current);
    await start(dependencies);
    vi.mocked(dependencies.dispatch).mockClear();
    current.teamPickup = { handoffId: "h1", cwd: root, branch: "feature/task", status: "pending" };
    await expect(start(dependencies)).rejects.toThrow(/read-only/);
    await reconcileOrchestration(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).not.toHaveBeenCalled();
  });
  it.each(["pending", "accepted"] as const)("refuses new runs and skips reconciliation for a handed task (%s)", async (status) => {
    const current = task();
    const dependencies = deps(current);
    await start(dependencies);
    vi.mocked(dependencies.dispatch).mockClear();
    current.handoff = { handoffId: "h1", toUserId: "U2", toName: "helper", status, expiresAt: Date.now() + 1000 };
    await expect(start(dependencies)).rejects.toThrow(/handed off/);
    await reconcileOrchestration(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).not.toHaveBeenCalled();
  });
  it("records the orchestration and dispatches one plan run linked to the task", async () => {
    const d = deps();
    const result = await start(d);
    expect(result).toMatchObject({ created: true, runId: "run-orch0001-0000000a", dispatchError: null });
    expect(result.orchestration).toMatchObject({ status: "running", executionStep: "plan", runIds: ["run-orch0001-0000000a"], repo: { name: "org/app", cwd: path.join(root, "app") } });
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    const [dispatchInput, options] = vi.mocked(d.dispatch).mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(dispatchInput).toMatchObject({
      cwd: path.join(root, "app"), worktree: false, depth: 0,
      activity: { source: "interactive", action: "plan", taskId: TASK_ID, taskDate: "2026-10-15", repoName: "org/app" },
    });
    expect(String(dispatchInput.prompt)).toContain("devhub-plan-write");
    expect(String(dispatchInput.requestId)).toMatch(/^storyboard-orchestrate-/);
    expect(options).toEqual({ defer: true });
    expect(readOrchestration(TASK_ID, notes)?.revision).toBe(2);
  });

  it("is idempotent: a second start returns the existing orchestration without a second run", async () => {
    const d = deps();
    await start(d);
    const again = await start(d);
    expect(again).toMatchObject({ created: false, runId: null });
    expect(again.orchestration.runIds).toHaveLength(1);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("replays a lost response with the same request ID instead of a new one", async () => {
    const d = deps();
    const first = input();
    await start(d, first);
    const replay = await start(d, first);
    expect(replay.replayed).toBe(true);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches once when two starts race with different keys", async () => {
    const d = deps();
    const results = await Promise.all([start(d), start(d)]);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.runId)).toHaveLength(1);
    expect(readOrchestration(TASK_ID, notes)).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"] });
  });

  it("dispatches one plan run when the same start is sent twice at once", async () => {
    const d = deps();
    const first = input();
    const results = await Promise.all([start(d, first), start(d, first)]);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.replayed)).toEqual([false, true]);
    expect(readOrchestration(TASK_ID, notes)).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"] });
    expect(readOrchestration(TASK_ID, notes)?.auto?.runs).toHaveLength(1);
  });

  it("recovers a claim stranded in starting when the same request is replayed", async () => {
    const first = input();
    const crashed = deps(task(), { dispatch: vi.fn(async () => { throw new Error("process died mid-dispatch"); }) });
    // Simulate the crash: keep the Phase A claim, lose the Phase B outcome.
    await start(crashed, first);
    const file = path.join(notes, ".config", "storyboard", "orchestrations", `${TASK_ID}.json`);
    const stranded = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...stranded, status: "starting", lastError: undefined }));
    const d = deps();
    const replay = await start(d, first);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.dispatch).mock.calls[0][0].requestId).toBe(`storyboard-orchestrate-${replay.orchestration.auto!.cycleId}-${first.idempotencyKey}`);
    expect(replay.orchestration).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"] });
  });

  it("does not pause a start that a concurrent replay already gave a run", async () => {
    const first = input();
    const d = deps(task(), {
      dispatch: vi.fn(async () => {
        // The replay of this request wins the race and records its run while this dispatch is still failing.
        await start(deps(), first);
        throw new AgentDispatchError("Paseo is unavailable.", 503);
      }),
    });
    const result = await start(d, first);
    expect(result.dispatchError).toBe("Paseo is unavailable.");
    expect(result.orchestration).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"] });
    expect(result.orchestration.lastError).toBeUndefined();
  });

  it("asks which repo instead of guessing when the task has none", async () => {
    const d = deps(task({ links: [] }));
    const result = await start(d);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(result.orchestration).toMatchObject({ status: "needs-you", runIds: [] });
    expect(result.orchestration.questions).toEqual([expect.objectContaining({ id: "repo", kind: "repo", state: "open", prompt: "Which repo should this task run in?" })]);
  });

  it("reports repo lookup failures instead of asking a misleading checkout question", async () => {
    const d = deps(task(), { resolveRepos: vi.fn(async () => { throw new Error("Repo lookup failed"); }) });
    await expect(start(d)).rejects.toThrow("Repo lookup failed");
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(readOrchestration(TASK_ID, notes)).toBeNull();
  });

  it("asks when the linked repo is not cloned locally", async () => {
    const d = deps(task(), { resolveRepos: vi.fn(async () => []) });
    const result = await start(d);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(result.orchestration.questions[0].prompt).toMatch(/Which checkout is org\/app/);
  });

  it("starting again once the repo is known answers the question and dispatches", async () => {
    await start(deps(task({ links: [] })));
    const d = deps();
    const result = await start(d, input({ cwd: path.join(root, "app"), repoName: "app" }));
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    expect(result.orchestration.status).toBe("running");
    expect(result.orchestration.questions[0]).toMatchObject({ state: "answered", answer: "app" });
  });

  it("pauses with the reason when dispatch is refused, and retries on the next start", async () => {
    const refused = deps(task(), { dispatch: vi.fn(async () => { throw new AgentDispatchError("Paseo is unavailable.", 503); }) });
    const paused = await start(refused);
    expect(paused).toMatchObject({ runId: null, dispatchError: "Paseo is unavailable." });
    expect(paused.orchestration).toMatchObject({ status: "paused", lastError: "Paseo is unavailable.", runIds: [] });
    const d = deps();
    const retried = await start(d);
    expect(retried.orchestration).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"] });
    expect(retried.orchestration.lastError).toBeUndefined();
  });

  it("refuses a missing or closed task", async () => {
    await expect(start(deps(null))).rejects.toMatchObject({ status: 404 });
    const closed = await start(deps(task({ done: true }))).catch((error: unknown) => error);
    expect(closed).toBeInstanceOf(StoryboardError);
    expect((closed as StoryboardError).status).toBe(409);
    expect(readOrchestration(TASK_ID, notes)).toBeNull();
    // An abandoned task is closed work too: the board hides it, so a start would be invisible spend.
    await expect(start(deps(task({ abandonedAt: "2026-10-17T09:00:00.000Z" })))).rejects.toMatchObject({ status: 409 });
    expect(readOrchestration(TASK_ID, notes)).toBeNull();
  });
});

describe("Start on auto and auto mode", () => {
  it("starts the auto-mode state machine at plan and records the plan run", async () => {
    const prepareTaskQa = vi.fn();
    const result = await start(deps(task({ text: "Fix the sidebar layout" }), { prepareTaskQa: prepareTaskQa as never, activeHeavyJobs: () => 0, activeQaJobs: () => 0 }));
    expect(result.runId).toBe("run-orch0001-0000000a");
    expect(readOrchestration(TASK_ID, notes)!.auto).toMatchObject({ phase: "plan", round: 0, maxRounds: 2, origin: "http://localhost:1337", runs: [{ runId: "run-orch0001-0000000a", phase: "plan" }] });
    // The "before" video waits until the plan is settled (auto mode's baseline phase).
    expect(prepareTaskQa).not.toHaveBeenCalled();
  });

  it("starts auto mode even when it has to ask for the repo first", async () => {
    await start(deps(task({ links: [] })));
    expect(readOrchestration(TASK_ID, notes)).toMatchObject({ status: "needs-you", auto: { phase: "plan", runs: [] } });
  });
});

describe("automatic QA after implementation", () => {
  const qaRun = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    requestId: "ffffffff-1111-4222-8333-444444444444",
    scenarioId: "storyboard-task",
    taskId: TASK_ID,
    createdAt: "2026-10-16T10:00:00.000Z",
    state: "running" as const,
  };

  it("claims a completed implementation once and returns its linked Jev execution", async () => {
    const execute = vi.fn(async () => undefined);
    const prepareTaskQa = vi.fn(() => ({ skipped: false as const, run: qaRun, execute }));
    const d = deps(task(), {
      prepareTaskQa,
      activeHeavyJobs: () => 0,
      activeQaJobs: () => 0,
      readPlanNote: () => "## Preview\n\nhttp://localhost:4173",
    });
    await finishedImplementation(d);
    const results = await Promise.all([
      reconcileOrchestration(TASK_ID, d, notes),
      reconcileOrchestration(TASK_ID, d, notes),
    ]);
    expect(prepareTaskQa).toHaveBeenCalledTimes(1);
    expect(prepareTaskQa).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: TASK_ID }),
      sourceRunId: "run-orch0001-0000000a",
    }), notes);
    expect(results.filter((result) => result.execute === execute)).toHaveLength(1);
    expect(readOrchestration(TASK_ID, notes)).toMatchObject({ executionStep: "verify", status: "running" });
  });

  it("skips cleanly with a visible reason when the task has no runnable target", async () => {
    const d = deps(task(), { activeHeavyJobs: () => 0, activeQaJobs: () => 0 });
    await finishedImplementation(d);
    const result = await reconcileOrchestration(TASK_ID, d, notes);
    expect(result.execute).toBeUndefined();
    expect(result.orchestration).toMatchObject({
      executionStep: "verify",
      status: "paused",
      lastError: "QA skipped: no runnable app or preview URL was found on the task or in its note.",
    });
  });

  it("defers a third heavy job and retries it when capacity opens", async () => {
    let heavyJobs = 2;
    const execute = vi.fn(async () => undefined);
    const prepareTaskQa = vi.fn(() => ({ skipped: false as const, run: qaRun, execute }));
    const d = deps(task(), {
      prepareTaskQa,
      activeHeavyJobs: () => heavyJobs,
      activeQaJobs: () => 0,
    });
    await finishedImplementation(d);
    const queued = await reconcileOrchestration(TASK_ID, d, notes);
    expect(queued.orchestration).toMatchObject({
      executionStep: "verify",
      status: "starting",
      lastError: "QA queued: two heavy jobs are already running.",
    });
    expect(prepareTaskQa).not.toHaveBeenCalled();
    heavyJobs = 1;
    const started = await reconcileOrchestration(TASK_ID, d, notes);
    expect(started.execute).toBe(execute);
    expect(prepareTaskQa).toHaveBeenCalledTimes(1);
  });

  it("queues when another dashboard process wins the QA workspace lease", async () => {
    const d = deps(task(), {
      prepareTaskQa: () => { throw new Error("A QA runner already owns this workspace."); },
      activeHeavyJobs: () => 1,
      activeQaJobs: () => 0,
    });
    await finishedImplementation(d);
    const result = await reconcileOrchestration(TASK_ID, d, notes);
    expect(result.orchestration).toMatchObject({
      executionStep: "verify",
      status: "starting",
      lastError: "QA queued: another Jev QA run owns the workspace.",
    });
  });
});

describe("checkout vs worktree", () => {
  it("defaults to the checkout and isolates dirty, busy or risky work", () => {
    expect(chooseCheckoutMode({ dirty: false, activeRuns: 0 }, null)).toMatchObject({ mode: "checkout" });
    expect(chooseCheckoutMode({ dirty: true, activeRuns: 0 }, null)).toEqual({ mode: "worktree", reason: "checkout has uncommitted changes" });
    expect(chooseCheckoutMode({ dirty: false, activeRuns: 2 }, null)).toEqual({ mode: "worktree", reason: "2 other runs active on this repo" });
    expect(chooseCheckoutMode({ dirty: false, activeRuns: 0 }, taskRiskReason({ text: "Refactor the auth layer" }))).toMatchObject({ mode: "worktree", reason: expect.stringContaining("risky") });
    expect(taskRiskReason({ text: "Fix typo in footer" })).toBeNull();
    expect(taskRiskReason({ text: "x".repeat(400) })).toBe("task looks large (long description)");
  });

  it("no longer flags 'author'/'authored', but still catches 'auth' and its long forms", () => {
    expect(taskRiskReason({ text: "Credit the author in the changelog" })).toBeNull();
    expect(taskRiskReason({ text: "Fix the authored-by field on PRs" })).toBeNull();
    expect(taskRiskReason({ text: "Rotate the auth token" })).toMatch(/risky \("auth"\)/);
    expect(taskRiskReason({ text: "Rework authentication" })).toMatch(/risky \("authentication"\)/);
    expect(taskRiskReason({ text: "Fix the authorization header" })).toMatch(/risky \("authorization"\)/);
  });

  it("only flags 'delete' near something destructive, not any mention of it", () => {
    expect(taskRiskReason({ text: "Delete the old button" })).toBeNull();
    expect(taskRiskReason({ text: "Delete this comment from the review" })).toBeNull();
    expect(taskRiskReason({ text: "Delete the stale rows from the database" })).toMatch(/risky \("delete"\)/);
    expect(taskRiskReason({ text: "Delete the feature branch after merge" })).toMatch(/risky \("delete"\)/);
  });

  it("sizes 'large' on real scope (planned files and steps, or the diff), never on how long the note is", () => {
    // A short task with a long, chatty note stays in the checkout.
    const chatty = `## Plan\n- Add the toggle to src/settings/Appearance.tsx\n- Save it in localStorage\n\n## Decisions\n${"Long reasoning about the choice. ".repeat(40)}`;
    expect(taskRiskReason({ text: "Add a dark-mode toggle" }, chatty)).toBeNull();
    expect(taskRiskReason({ text: "Fix typo" }, "x".repeat(4000))).toBeNull();
    const files = `## Plan\n${Array.from({ length: 9 }, (_, i) => `- Update src/feature/part${i}.ts`).join("\n")}`;
    expect(taskRiskReason({ text: "Fix typo" }, files)).toBe("task looks large (9 files in the plan)");
    const steps = `## Waypoints\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. Step ${i + 1}`).join("\n")}\n## Log\n${"- noise\n".repeat(30)}`;
    expect(taskRiskReason({ text: "Fix typo" }, steps)).toBe("task looks large (12 planned steps)");
    // Paths inside fenced code (a pasted listing) don't count.
    expect(taskRiskReason({ text: "Fix typo" }, `\`\`\`\n${Array.from({ length: 20 }, (_, i) => `src/a${i}.ts`).join("\n")}\n\`\`\``)).toBeNull();
    // Once Build has a diff, the diff decides.
    expect(taskRiskReason({ text: "Fix typo" }, files, { files: 2, lines: 40 })).toBeNull();
    expect(taskRiskReason({ text: "Fix typo" }, null, { files: 30, lines: 900 })).toBe("task looks large (30 files, 900 lines changed)");
    // No note yet: a very long title still counts as a long description.
    expect(taskRiskReason({ text: "x".repeat(400) }, null)).toBe("task looks large (long description)");
    expect(planScope("## Plan\n1. a in a.ts\n2. b in b.ts\n## Other\n- c")).toEqual({ files: 2, steps: 2 });
  });

  it("counts plan steps under subheadings but stops at the next peer section", async () => {
    const plan = `## Plan\n### First pass\n${"- Change a behaviour\n".repeat(6)}### Second pass\n${"- Check a behaviour\n".repeat(6)}## Log\n${"- Not a planned step\n".repeat(20)}`;
    expect(planScope(plan)).toEqual({ files: 0, steps: 12 });
    const d = deps(task({ text: "Fix typo" }), { readPlanNote: () => plan });
    const result = await start(d);
    expect(result.orchestration.checkout).toMatchObject({ mode: "worktree", reason: "task looks large (12 planned steps)" });
    expect(vi.mocked(d.dispatch).mock.calls[0][0]).toMatchObject({ worktree: true });
  });

  it("isolates into a worktree when the plan's scope (not the title) looks large", async () => {
    const d = deps(task({ text: "Fix typo" }), { readPlanNote: vi.fn(() => `## Plan\n${Array.from({ length: 8 }, (_, i) => `- src/p${i}.ts`).join("\n")}`) });
    const result = await start(d);
    expect(result.orchestration.checkout).toMatchObject({ mode: "worktree", reason: expect.stringContaining("large") });
  });

  it("records the choice and reason, and dispatches into a worktree when the checkout is dirty", async () => {
    const d = deps(task(), { inspectCheckout: vi.fn(async () => ({ dirty: true, activeRuns: 0 })) });
    const result = await start(d);
    expect(result.orchestration.checkout).toMatchObject({ mode: "worktree", reason: "checkout has uncommitted changes" });
    expect(vi.mocked(d.dispatch).mock.calls[0][0]).toMatchObject({ worktree: true });
  });

  it("doesn't point a worktree run back at the checkout it was isolated from", async () => {
    const d = deps(task(), { inspectCheckout: vi.fn(async () => ({ dirty: true, activeRuns: 0 })) });
    await start(d);
    const prompt = String(vi.mocked(d.dispatch).mock.calls[0][0].prompt);
    expect(prompt).not.toContain(path.join(root, "app"));
    expect(prompt).toContain("isolated worktree");
    expect(prompt).toContain("Read only");
  });

  it("records a checkout choice for a clean, quiet repo", async () => {
    const result = await start(deps());
    expect(result.orchestration.checkout).toMatchObject({ mode: "checkout" });
  });
});

describe("missing-repo answer", () => {
  it("resolves the canonical repo name from the folder instead of trusting the client", async () => {
    const noRepo = task({ links: [] });
    const d = deps(noRepo);
    const asked = await start(d);
    expect(asked.orchestration.status).toBe("needs-you");
    const answered = await answerRepoQuestion({ action: "answer-repo", taskId: TASK_ID, taskDate: "2026-10-15", idempotencyKey: key(), cwd: path.join(root, "app") }, { origin: "http://localhost:1337" }, d, notes);
    expect(d.linkRepo).toHaveBeenCalledWith(TASK_ID, "2026-10-15", "org/app", undefined);
    expect(answered.orchestration).toMatchObject({ status: "running", runIds: ["run-orch0001-0000000a"], repo: { name: "org/app" } });
    expect(answered.orchestration.questions[0]).toMatchObject({ state: "answered", answer: "org/app" });
  });

  it("rejects a folder it can't resolve to a known repo, without linking it", async () => {
    const d = deps(task({ links: [] }));
    await start(d);
    await expect(answerRepoQuestion({ action: "answer-repo", taskId: TASK_ID, taskDate: "2026-10-15", idempotencyKey: key(), cwd: "/Users/x/unknown-folder" }, { origin: "http://localhost:1337" }, d, notes))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("isn't a repo") });
    expect(d.linkRepo).not.toHaveBeenCalled();
    expect(readOrchestration(TASK_ID, notes)?.status).toBe("needs-you");
  });

  const answer = (d: OrchestratorDeps, idempotencyKey = key(), cwd = path.join(root, "app")) =>
    answerRepoQuestion({ action: "answer-repo", taskId: TASK_ID, taskDate: "2026-10-15", idempotencyKey, cwd }, { origin: "http://localhost:1337" }, d, notes);

  it("refuses a stale answer without rewriting the task's repo link", async () => {
    const d = deps();
    await start(d); // Has a repo: running, no question.
    await expect(answer(d)).rejects.toMatchObject({ status: 409 });
    expect(d.linkRepo).not.toHaveBeenCalled();
  });

  it("refuses a folder dispatch would refuse, before linking it", async () => {
    const d = deps(task({ links: [] }), { validateCwd: vi.fn(() => { throw new AgentDispatchError("cwd must be inside /Users/x", 400); }) });
    await start(d);
    await expect(answer(d, key(), "/etc")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("inside") });
    expect(d.linkRepo).not.toHaveBeenCalled();
    expect(readOrchestration(TASK_ID, notes)?.status).toBe("needs-you");
  });

  it("replays a retried answer without linking twice or dispatching twice", async () => {
    const d = deps(task({ links: [] }));
    await start(d);
    const retryKey = key();
    await answer(d, retryKey);
    const again = await answer(d, retryKey);
    expect(again).toMatchObject({ replayed: true, orchestration: { status: "running" } });
    expect(d.linkRepo).toHaveBeenCalledTimes(1);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("uses the orchestration record's taskDate rather than trusting the request body", async () => {
    const d = deps(task({ links: [] }));
    await start(d, input({ taskDate: "2026-10-15" }));
    const answered = await answerRepoQuestion({ action: "answer-repo", taskId: TASK_ID, taskDate: "2099-01-01", idempotencyKey: key(), cwd: path.join(root, "app") }, { origin: "http://localhost:1337" }, d, notes);
    expect(d.linkRepo).toHaveBeenCalledWith(TASK_ID, "2026-10-15", "org/app", undefined);
    expect(answered.orchestration.taskDate).toBe("2026-10-15");
  });
});

describe("Auto/Manual switch", () => {
  it("continues the same phase with owner guidance while keeping pause-after-plan and tiers", async () => {
    let next = 0;
    const d = deps(task(), { dispatch: vi.fn(async () => ({ spec: { id: `run-notes0001-000000${++next}0` } }) as unknown as AgentRun) });
    await start(d, input({ pauseAfterPlan: true, tiers: DEFAULT_MODEL_TIERS }));
    await setOrchestrationMode({ action: "mode", taskId: TASK_ID, mode: "manual", idempotencyKey: key() }, { origin: "http://localhost:1337" }, d, notes);
    const before = readOrchestration(TASK_ID, notes)!;
    const result = await setOrchestrationMode({ action: "mode", taskId: TASK_ID, mode: "auto", guidance: "Note from John: keep API", idempotencyKey: key() }, { origin: "http://localhost:1337" }, d, notes);
    expect(result.orchestration.auto?.phase).toBe(before.auto?.phase);
    expect(result.orchestration.auto?.pauseAfterPlan).toBe(true);
    expect(result.orchestration.tiers).toEqual(before.tiers);
    expect(vi.mocked(d.dispatch).mock.calls.at(-1)![0].prompt).toContain("Note from John: keep API");
  });
  const mode = (d: OrchestratorDeps, value: "auto" | "manual") => setOrchestrationMode({ action: "mode", taskId: TASK_ID, mode: value, idempotencyKey: key() }, { origin: "http://localhost:1337" }, d, notes);

  it("Manual cancels the active run and parks the record; Auto dispatches a fresh run", async () => {
    let n = 0;
    const d = deps(task(), { dispatch: vi.fn(async () => ({ spec: { id: `run-orch0001-000000${++n}0` } }) as unknown as AgentRun) });
    await start(d);
    const manual = await mode(d, "manual");
    expect(d.cancelRun).toHaveBeenCalledWith("run-orch0001-00000010");
    expect(manual).toMatchObject({ cancelled: "signalled", orchestration: { status: "paused-manual" } });

    const again = await mode(d, "manual");
    expect(d.cancelRun).toHaveBeenCalledTimes(1);
    expect(again.orchestration.status).toBe("paused-manual");

    const auto = await mode(d, "auto");
    expect(auto).toMatchObject({ runId: "run-orch0001-00000020", orchestration: { status: "running", runIds: ["run-orch0001-00000010", "run-orch0001-00000020"] } });
    // Auto mode resumes its current phase (plan) on a fresh attempt, with a request ID of its own.
    expect(String(vi.mocked(d.dispatch).mock.calls[1][0].requestId)).toMatch(/^storyboard-auto-.+-plan-r0-a1$/);
  });

  it("Auto on a task that is already running is a no-op", async () => {
    const d = deps();
    await start(d);
    const result = await mode(d, "auto");
    expect(result.runId).toBeNull();
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("Manual during an in-flight start wins: the new run is recorded and stopped", async () => {
    const d: OrchestratorDeps = deps(task(), {
      dispatch: vi.fn(async () => {
        await mode(d, "manual"); // The user flips while the dispatch is still starting.
        return { spec: { id: "run-orch0001-0000000b" } } as unknown as AgentRun;
      }),
    });
    const result = await start(d);
    expect(result.orchestration).toMatchObject({ status: "paused-manual", runIds: ["run-orch0001-0000000b"] });
    expect(d.cancelRun).toHaveBeenCalledWith("run-orch0001-0000000b");
  });

  it("Manual during an in-flight resume stops the resumed run instead of orphaning it", async () => {
    let n = 0;
    const d: OrchestratorDeps = deps(task(), {
      dispatch: vi.fn(async () => {
        n += 1;
        if (n === 2) await mode(d, "manual");
        return { spec: { id: `run-orch0001-000000${n}0` } } as unknown as AgentRun;
      }),
    });
    await start(d);
    await mode(d, "manual");
    const resumed = await mode(d, "auto");
    expect(resumed.orchestration).toMatchObject({ status: "paused-manual", runIds: ["run-orch0001-00000010", "run-orch0001-00000020"] });
    expect(d.cancelRun).toHaveBeenLastCalledWith("run-orch0001-00000020");
  });

  it("a resume that can't dispatch stays Manual with the reason, and Auto again retries", async () => {
    let fail = false;
    const d = deps(task(), {
      dispatch: vi.fn(async () => {
        if (fail) throw new AgentDispatchError("Paseo is offline", 503);
        return { spec: { id: "run-orch0001-0000000a" } } as unknown as AgentRun;
      }),
    });
    await start(d);
    await mode(d, "manual");
    fail = true;
    const failed = await mode(d, "auto");
    expect(failed).toMatchObject({ runId: null, dispatchError: "Paseo is offline", orchestration: { status: "paused-manual", lastError: "Couldn't resume auto: Paseo is offline" } });
    fail = false;
    const retried = await mode(d, "auto");
    expect(retried.orchestration).toMatchObject({ status: "running" });
    expect(retried.orchestration.lastError).toBeUndefined();
  });

  it("won't resume a task that was closed while Manual", async () => {
    const open = task();
    const d = deps(open, { findTask: vi.fn(async () => open) });
    await start(d);
    await mode(d, "manual");
    open.done = true;
    const result = await mode(d, "auto");
    expect(result.orchestration).toMatchObject({ status: "paused-manual", lastError: expect.stringContaining("closed") });
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("won't resume a task that was abandoned while Manual", async () => {
    const open = task();
    const d = deps(open, { findTask: vi.fn(async () => open) });
    await start(d);
    await mode(d, "manual");
    open.abandonedAt = "2026-10-17T09:00:00.000Z";
    const result = await mode(d, "auto");
    expect(result.orchestration).toMatchObject({ status: "paused-manual", lastError: expect.stringContaining("closed") });
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("doesn't count this task's own winding-down run as another run in the checkout", async () => {
    const d = deps();
    await start(d);
    await mode(d, "manual");
    await mode(d, "auto");
    expect(vi.mocked(d.inspectCheckout).mock.calls.at(-1)?.[1]).toEqual(["run-orch0001-0000000a"]);
  });

  it("keeps the record honest when the run will not stop", async () => {
    const d = deps(task(), { cancelRun: vi.fn(async () => { throw new Error("runtime offline"); }) });
    await start(d);
    const result = await mode(d, "manual");
    expect(result.orchestration).toMatchObject({ status: "paused-manual", lastError: expect.stringContaining("runtime offline") });
  });
});

describe("replaceRepoLink", () => {
  it("replaces only the link the question was about, keeping the task's other repo links", () => {
    const links = [
      { kind: "repo" as const, id: "org/other-service", label: "other-service" },
      { kind: "note" as const, id: "notes/foo", label: "foo" },
    ];
    expect(replaceRepoLink(links, "org/app", "org/other-service")).toEqual([
      { kind: "note", id: "notes/foo", label: "foo" },
      { kind: "repo", id: "org/app", label: "app" },
    ]);
  });

  it("appends without touching other links when there was no previous repo to replace", () => {
    const links = [{ kind: "repo" as const, id: "org/other-service", label: "other-service" }];
    expect(replaceRepoLink(links, "org/app", undefined)).toEqual([
      { kind: "repo", id: "org/other-service", label: "other-service" },
      { kind: "repo", id: "org/app", label: "app" },
    ]);
  });

  it("doesn't duplicate a link when the new repo name matches an existing one", () => {
    const links = [{ kind: "repo" as const, id: "org/app", label: "app" }];
    expect(replaceRepoLink(links, "org/app", undefined)).toEqual([{ kind: "repo", id: "org/app", label: "app" }]);
  });

  it("handles no links yet", () => {
    expect(replaceRepoLink(undefined, "org/app")).toEqual([{ kind: "repo", id: "org/app", label: "app" }]);
  });
});

it("preserves pauseAfterPlan through a missing-repo start and Manual/Auto", async () => {
  const d = deps(task({ links: [] }), { resolveRepos: vi.fn(async () => []) });
  await start(d, input({ pauseAfterPlan: true }));
  expect(readOrchestration(TASK_ID, notes)?.auto?.pauseAfterPlan).toBe(true);
  await mutateOrchestration(TASK_ID, null, (current) => {
    current!.status = "paused-manual";
    current!.repo = { cwd: "/repo" };
    current!.runIds = ["run-plan0001-0000000a"];
    current!.auto!.waiting = { kind: "plan-approval", reason: "Plan ready", at: new Date().toISOString() };
    return current;
  }, notes);
  await setOrchestrationMode({ action: "mode", taskId: TASK_ID, mode: "auto", idempotencyKey: key() }, { origin: "http://fixture" }, d, notes);
  expect(readOrchestration(TASK_ID, notes)).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "plan-approval" } } });
  expect(d.dispatch).not.toHaveBeenCalled();
});

it.each(["closed", "missing", "questions", "missing-note"] as const)("refuses plan approval for %s work without dispatching", async (reason) => {
  const { decideOrchestrationPlan } = await import("./orchestrator");
  const { readTaskNote } = await import("@shared/task-note/sections.ts");
  const d = deps();
  await start(d, input({ pauseAfterPlan: true }));
  const view = readTaskNote([]);
  if (reason === "questions") view.questions = [{ id: "q", text: "Which API?", resolved: false }];
  const guarded = deps(reason === "missing" ? null : task({ done: reason === "closed" }), { auto: { noteView: () => ({ view: reason === "missing-note" ? null : view, markdown: "Plan", notePath: "task-notes/test" }) } });
  await expect(decideOrchestrationPlan({ action: "plan-decision", taskId: TASK_ID, planRunId: "run-orch0001-0000000a", decision: "approve", idempotencyKey: key() }, guarded, notes)).rejects.toMatchObject({ status: reason === "missing" ? 404 : 409 });
  expect(guarded.dispatch).not.toHaveBeenCalled();
});


it.each(["approve", "revise"] as const)("updates the note immediately after %s even while capacity is full", async (decision) => {
  const { decideOrchestrationPlan } = await import("./orchestrator");
  const { readTaskNote } = await import("@shared/task-note/sections.ts");
  const d = deps();
  await start(d, input({ pauseAfterPlan: true }));
  await mutateOrchestration(TASK_ID, null, (current) => {
    current!.status = "needs-you";
    current!.auto!.waiting = { kind: "plan-approval", reason: "Plan ready", at: new Date().toISOString() };
    return current;
  }, notes);
  const setNoteStatus = vi.fn();
  const guarded = deps(task(), { auto: {
    noteView: () => ({ view: readTaskNote([]), markdown: "Plan", notePath: "task-notes/test" }),
    runStatus: () => "done",
    setNoteStatus,
    activeHeavyJobs: () => 2,
    activeQaJobs: () => 0,
    detectUi: async () => ({ detected: true, reason: "UI" }),
    resolvePreview: async () => ({ url: "http://fixture", state: "url", reason: "Fixture" }),
  } });
  await decideOrchestrationPlan({ action: "plan-decision", taskId: TASK_ID, planRunId: "run-orch0001-0000000a", decision, guidance: "Keep the API", idempotencyKey: key() }, guarded, notes);
  expect(setNoteStatus).toHaveBeenCalledWith(task(), "2026-10-15", decision === "approve" ? "in-progress" : "planning");
  expect(guarded.dispatch).not.toHaveBeenCalled();
});

describe("resetTaskToTodo", () => {
  it("does not reuse the initial plan request after reset even with the same client key", async () => {
    const d = deps(task(), { auto: { setNoteStatus: vi.fn() } });
    const request = input();
    await start(d, request);
    await resetTaskToTodo({ action: "reset", taskId: TASK_ID, discardWork: false }, d, notes);
    await start(d, request);
    const calls = vi.mocked(d.dispatch).mock.calls;
    expect(calls[1][0].requestId).not.toBe(calls[0][0].requestId);
  });

  it("keeps the record and checkout when cancellation fails", async () => {
    const setNoteStatus = vi.fn();
    const d = deps(task(), { cancelRun: vi.fn(async () => { throw new Error("runtime offline"); }), auto: { setNoteStatus } });
    await start(d);
    await expect(resetTaskToTodo({ action: "reset", taskId: TASK_ID, discardWork: true }, d, notes)).rejects.toThrow("runtime offline");
    expect(readOrchestration(TASK_ID, notes)?.status).toBe("paused-manual");
    expect(setNoteStatus).not.toHaveBeenCalled();
  });

  it("does not forget auto when the note cannot be reset", async () => {
    const d = deps(task(), { auto: { setNoteStatus: () => { throw new Error("note unavailable"); } } });
    await start(d);
    await expect(resetTaskToTodo({ action: "reset", taskId: TASK_ID, discardWork: false }, d, notes)).rejects.toThrow("note unavailable");
    expect(readOrchestration(TASK_ID, notes)?.status).toBe("paused-manual");
  });

  it("resets a manual task with no orchestration", async () => {
    const setNoteStatus = vi.fn();
    const d = deps(task(), { auto: { setNoteStatus } });
    await resetTaskToTodo({ action: "reset", taskId: TASK_ID, discardWork: false }, d, notes);
    expect(setNoteStatus).toHaveBeenCalledWith(task(), task().startDate, "todo");
  });

  it("waits for an in-flight start and cancels its new run", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredDispatch = new Promise<void>((resolve) => { entered = resolve; });
    const pendingDispatch = new Promise<void>((resolve) => { release = resolve; });
    const d = deps(task(), { dispatch: vi.fn(async () => {
      entered();
      await pendingDispatch;
      return { spec: { id: "run-late0001-0000000a" } } as unknown as AgentRun;
    }), auto: { setNoteStatus: vi.fn() } });
    const starting = start(d);
    await enteredDispatch;
    const resetting = resetTaskToTodo({ action: "reset", taskId: TASK_ID, discardWork: false }, d, notes);
    release();
    await Promise.all([starting, resetting]);
    expect(d.cancelRun).toHaveBeenCalledWith("run-late0001-0000000a");
    expect(readOrchestration(TASK_ID, notes)).toBeNull();
  });

  it("stops the runs and forgets auto mode, keeping the checkouts unless asked", async () => {
    const d = deps(task(), { auto: { setNoteStatus: vi.fn() } });
    await mutateOrchestration("11111111-2222-3333-4444-555555555555", null, () => {
      const record = newOrchestration({ taskId: "11111111-2222-3333-4444-555555555555", taskDate: "2026-10-17" });
      record.runIds = ["run-one00001-0000000a"];
      return record;
    }, notes);
    const result = await resetTaskToTodo({ action: "reset", taskId: "11111111-2222-3333-4444-555555555555", discardWork: false }, d, notes);
    expect(d.cancelRun).toHaveBeenCalledWith("run-one00001-0000000a");
    expect(result).toMatchObject({ stoppedRuns: 1, removedCheckouts: [] });
    expect(readOrchestration("11111111-2222-3333-4444-555555555555", notes)).toBeNull();
  });
});

describe("Start on auto for a task parked on Manual", () => {
  it("restores Ready without leaving a finished cycle stuck on Starting", async () => {
    const d = deps();
    await start(d);
    await mutateOrchestration(TASK_ID, null, (current) => {
      current!.status = "paused-manual";
      current!.auto!.phase = "ready";
      return current;
    }, notes);
    const resumed = await start(d);
    expect(resumed.orchestration.status).toBe("ready-for-review");
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it("switches it back to Auto instead of doing nothing", async () => {
    const d = deps();
    const first = await start(d);
    await mutateOrchestration(first.orchestration.taskId, null, (current) => { current!.status = "paused-manual"; return current; }, notes);
    const again = await start(d, { ...input(), idempotencyKey: "second-click-000000000000000001" });
    expect(again.created).toBe(false);
    expect(again.orchestration.status).not.toBe("paused-manual");
  });
});

describe("skip planning", () => {
  it("starts straight at Implement with no plan run, and tells the agent there is no plan", async () => {
    const d = deps();
    const result = await start(d, input({ skipPlan: true }));
    expect(result.created).toBe(true);
    const record = readOrchestration(TASK_ID, notes)!;
    expect(record.launchOptions?.skipPlan).toBe(true);
    expect(record.auto?.phase).toBe("implement");
    const prompts = vi.mocked(d.dispatch).mock.calls.map(([call]) => ({ action: call.activity?.action, prompt: call.prompt }));
    expect(prompts.some((entry) => entry.action === "plan")).toBe(false);
    expect(prompts.find((entry) => entry.action === "implement")?.prompt).toContain("Planning was skipped on purpose");
  });
});
