import { describe, expect, it } from "vitest";
import {
  agentActivityHrefForRun,
  buildTaskAgentResumePrompt,
  canResumeTaskAgentRun,
  isTaskAgentResumableStatus,
  mapAgentDispatchProviderToUi,
  mapUiProviderToAgentDispatch,
  newInteractiveTaskAgentRunId,
  taskAgentChipForLatestRun,
  willResumeFollowUpSession,
} from "@/lib/tasks/task-agent-resume";

describe("canResumeTaskAgentRun / resumable statuses", () => {
  it("allows paused, abandoned, and failed", () => {
    expect(canResumeTaskAgentRun("paused")).toBe(true);
    expect(canResumeTaskAgentRun("abandoned")).toBe(true);
    expect(canResumeTaskAgentRun("failed")).toBe(true);
    expect(canResumeTaskAgentRun("running")).toBe(false);
    expect(canResumeTaskAgentRun("done")).toBe(false);
    expect(canResumeTaskAgentRun("done", null)).toBe(false);
    expect(canResumeTaskAgentRun("done", "")).toBe(false);
    expect(canResumeTaskAgentRun("done", "433c5245-935c-44d4-bbee-fe091f8f3677")).toBe(true);
    expect(canResumeTaskAgentRun(null)).toBe(false);
  });

  it("classifies resumable statuses", () => {
    expect(isTaskAgentResumableStatus("paused")).toBe(true);
    expect(isTaskAgentResumableStatus("running")).toBe(false);
  });
});

describe("taskAgentChipForLatestRun", () => {
  it("maps running/queued → Running, paused → Paused, resumable → Ready to resume", () => {
    expect(taskAgentChipForLatestRun({ runId: "run-a1-deadbeef", status: "running" })).toEqual({
      kind: "running",
      label: "Running",
      runId: "run-a1-deadbeef",
      status: "running",
    });
    expect(taskAgentChipForLatestRun({ runId: "run-a1-deadbeef", status: "queued" })?.label).toBe("Running");
    expect(taskAgentChipForLatestRun({ runId: "run-a1-deadbeef", status: "paused" })?.label).toBe("Paused");
    expect(taskAgentChipForLatestRun({ runId: "run-a1-deadbeef", status: "failed" })).toEqual({
      kind: "ready",
      label: "Ready to resume",
      runId: "run-a1-deadbeef",
      status: "failed",
    });
    expect(taskAgentChipForLatestRun({ runId: "run-a1-deadbeef", status: "done" })).toBeNull();
    expect(
      taskAgentChipForLatestRun({
        runId: "run-a1-deadbeef",
        status: "done",
        sessionId: "433c5245-935c-44d4-bbee-fe091f8f3677",
      }),
    ).toEqual({
      kind: "ready",
      label: "Continue",
      runId: "run-a1-deadbeef",
      status: "done",
    });
    expect(taskAgentChipForLatestRun(null)).toBeNull();
  });
});

describe("buildTaskAgentResumePrompt", () => {
  it("injects handoff, plan URL, and implement-task contract", () => {
    const prompt = buildTaskAgentResumePrompt({
      origin: "http://127.0.0.1:1400",
      taskId: "task-1",
      date: "2026-09-16",
      handoff: "## Done\nA\n\n## Next\nB",
      priorRunId: "run-m1abc2-deadbeef",
      cwd: "/repos/app",
      jiraKey: "ABC-1",
    });
    expect(prompt).toContain("RESUME an in-progress DevHub task");
    expect(prompt).toContain("run-m1abc2-deadbeef");
    expect(prompt).toContain("## Done\nA");
    expect(prompt).toContain("/api/tasks/implement/plan?taskId=task-1&date=2026-09-16");
    expect(prompt).toContain("devhub-implement-task");
    expect(prompt).toContain("Working tree: /repos/app");
    expect(prompt).toContain("Jira ticket: ABC-1");
  });

  it("notes missing handoff without inventing content", () => {
    const prompt = buildTaskAgentResumePrompt({
      origin: "http://localhost:1337",
      taskId: "t",
      date: "2026-09-16",
      handoff: "  ",
    });
    expect(prompt).toContain("No durable handoff yet");
  });
});

describe("mapUiProviderToAgentDispatch / agentActivityHrefForRun", () => {
  it("maps UI provider ids and builds activity hrefs", () => {
    expect(mapUiProviderToAgentDispatch("chatgpt")).toBe("codex");
    expect(mapUiProviderToAgentDispatch("default")).toBeNull();
    expect(mapUiProviderToAgentDispatch("openchamber")).toBeNull();
    expect(mapUiProviderToAgentDispatch("cursor")).toBe("cursor");
    expect(agentActivityHrefForRun("run-x1-abcd1234")).toBe("/agent-activity?run=run-x1-abcd1234");
  });
});

describe("mapAgentDispatchProviderToUi / willResumeFollowUpSession", () => {
  it("maps dispatch ids back to UI picker ids", () => {
    expect(mapAgentDispatchProviderToUi("codex")).toBe("chatgpt");
    expect(mapAgentDispatchProviderToUi("claude")).toBe("claude");
    expect(mapAgentDispatchProviderToUi(undefined)).toBe("default");
  });

  it("only follows up when provider+session+supportsResume align", () => {
    expect(
      willResumeFollowUpSession({
        priorDispatchProvider: "claude",
        selectedUiProvider: "claude",
        priorSessionId: "sess-1",
        priorSupportsResume: true,
      }),
    ).toBe(true);
    expect(
      willResumeFollowUpSession({
        priorDispatchProvider: "claude",
        selectedUiProvider: "cursor",
        priorSessionId: "sess-1",
        priorSupportsResume: true,
      }),
    ).toBe(false);
    expect(
      willResumeFollowUpSession({
        priorDispatchProvider: "claude",
        selectedUiProvider: "claude",
        priorSessionId: null,
        priorSupportsResume: true,
      }),
    ).toBe(false);
  });

  it("mint interactive run ids that pass the sidecar validator shape", () => {
    const id = newInteractiveTaskAgentRunId();
    expect(id).toMatch(/^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/);
  });
});
