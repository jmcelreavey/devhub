import { describe, expect, it, vi } from "vitest";
import { StoryboardError } from "@/lib/storyboard/errors";
import { readSlackTaskReplyState, replyToTaskThread, type SlackTaskReplyDependencies, type SlackTaskReplyState } from "./thread-reply";

const mocks = vi.hoisted(() => ({ readOrchestration: vi.fn() }));
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: mocks.readOrchestration }));
vi.mock("./answers", () => ({ withSlackProfile: (_profile: string, work: () => unknown) => work() }));

function record(patch: Record<string, unknown>) {
  return { taskId: "task-1", terminal: null, status: "needs-you", ...patch };
}
const planWaiting = { phase: "plan", attempt: 1, waiting: { kind: "plan-approval" }, runs: [
  { runId: "old-plan", phase: "plan", attempt: 0 }, { runId: "plan-2", phase: "plan", attempt: 1 }, { runId: "impl", phase: "implement", attempt: 1 },
] };

describe("fresh task state for a thread reply", () => {
  it("is plan-ready only while auto waits for plan approval, with the current attempt's plan run", () => {
    mocks.readOrchestration.mockReturnValue(record({ auto: planWaiting }));
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "plan-ready", planRunId: "plan-2" });
    mocks.readOrchestration.mockReturnValue(record({ auto: { ...planWaiting, waiting: { kind: "questions" } } }));
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "idle" });
  });

  it("is running while the orchestration starts or runs, and idle with none or when terminal", () => {
    mocks.readOrchestration.mockReturnValue(record({ status: "running", auto: { ...planWaiting, waiting: undefined } }));
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "running" });
    mocks.readOrchestration.mockReturnValue(record({ status: "starting" }));
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "running" });
    mocks.readOrchestration.mockReturnValue(null);
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "idle" });
    mocks.readOrchestration.mockReturnValue(record({ status: "running", terminal: { kind: "done" } }));
    expect(readSlackTaskReplyState("work", "task-1")).toEqual({ kind: "idle" });
  });
});

const reply = { profile: "work", taskId: "task-1", label: "PTF-5275", text: "Can we make sure this applies to games too?", eventId: "Ev1" };

function setup(state: SlackTaskReplyState) {
  const deps = {
    state: vi.fn(() => state),
    revisePlan: vi.fn(async () => {}),
    saveNote: vi.fn(),
  } satisfies SlackTaskReplyDependencies;
  return deps;
}

describe("reply in a task's Slack thread with no open question", () => {
  it("sends plan feedback back as a revision and saves it to the note", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    const text = await replyToTaskThread(deps, reply);
    expect(deps.revisePlan).toHaveBeenCalledExactlyOnceWith("work", "task-1", "run-plan-1", reply.text, "Ev1");
    expect(deps.saveNote).toHaveBeenCalledExactlyOnceWith("work", "task-1", `Plan feedback (Slack): ${reply.text}`);
    expect(text).toBe("📝 Sent back for a revised plan with your feedback. Saved to the task note.");
  });

  it("saves the note before asking for the revision, so the new plan run can read it", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    const order: string[] = [];
    deps.saveNote.mockImplementation(() => { order.push("note"); });
    deps.revisePlan.mockImplementation(async () => { order.push("revise"); });
    await replyToTaskThread(deps, reply);
    expect(order).toEqual(["note", "revise"]);
  });

  it("says so when the plan moved on (409) and still saves the note", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    deps.revisePlan.mockRejectedValue(new StoryboardError("The plan changed. Refresh and review the latest plan.", 409));
    const text = await replyToTaskThread(deps, reply);
    expect(deps.saveNote).toHaveBeenCalledOnce();
    expect(text).toContain("couldn't send the plan back");
    expect(text).toContain("The plan changed");
    expect(text).toContain("Saved to the task note");
  });

  it("does not claim a revision when its outcome is unknown, and never leaks the error", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    deps.revisePlan.mockRejectedValue(new Error("secret-internal-detail"));
    const text = await replyToTaskThread(deps, reply);
    expect(text).toContain("couldn't confirm");
    expect(text).not.toContain("secret-internal-detail");
    expect(text).not.toContain("Sent back");
  });

  it("still asks for the revision when the note can't be saved, and says the note failed", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    deps.saveNote.mockImplementation(() => { throw new Error("note missing"); });
    const text = await replyToTaskThread(deps, reply);
    expect(deps.revisePlan).toHaveBeenCalledOnce();
    expect(text).toContain("Sent back for a revised plan");
    expect(text).toContain("couldn't save it to the task note");
  });

  it("keeps a long reply whole for the revision and trims only the one-line note", async () => {
    const deps = setup({ kind: "plan-ready", planRunId: "run-plan-1" });
    const long = `Games too.\n${"x".repeat(900)}`;
    await replyToTaskThread(deps, { ...reply, text: long });
    expect(deps.revisePlan).toHaveBeenCalledWith("work", "task-1", "run-plan-1", long, "Ev1");
    const line = deps.saveNote.mock.calls[0][2];
    expect(line.length).toBeLessThanOrEqual(600);
    expect(line).not.toContain("\n");
  });

  it("saves a reply to a running task as a note without interrupting the agent", async () => {
    const deps = setup({ kind: "running" });
    const text = await replyToTaskThread(deps, reply);
    expect(deps.revisePlan).not.toHaveBeenCalled();
    expect(deps.saveNote).toHaveBeenCalledExactlyOnceWith("work", "task-1", `Slack: ${reply.text}`);
    expect(text).toContain("Saved to the task note for PTF-5275.");
    expect(text).toContain("haven't interrupted");
  });

  it("saves a reply to an idle or finished task as a note", async () => {
    const deps = setup({ kind: "idle" });
    expect(await replyToTaskThread(deps, reply)).toBe("📝 Saved to the task note for PTF-5275.");
    expect(deps.revisePlan).not.toHaveBeenCalled();
    expect(deps.saveNote).toHaveBeenCalledOnce();
  });

  it("says when the note can't be saved instead of claiming it was", async () => {
    const deps = setup({ kind: "idle" });
    deps.saveNote.mockImplementation(() => { throw new Error("This task has been handed off and is read-only."); });
    const text = await replyToTaskThread(deps, reply);
    expect(text).toContain("Couldn't save");
    expect(text).toContain("handed off");
    expect(text).not.toContain("Nothing to answer");
  });
});

describe("approval words in a plan-ready thread", () => {
  it("never revise the plan and never approve it either", async () => {
    const deps: SlackTaskReplyDependencies = { state: () => ({ kind: "plan-ready", planRunId: "plan-2" }), revisePlan: vi.fn(), saveNote: vi.fn() };
    for (const text of ["approve", "LGTM", "looks good", "go ahead!"]) {
      const line = await replyToTaskThread(deps, { profile: "work", taskId: "task-1", label: "PTF-1", text, eventId: "e1" });
      expect(line).toContain("Approve plan");
    }
    expect(deps.revisePlan).not.toHaveBeenCalled();
    expect(deps.saveNote).not.toHaveBeenCalled();
    await replyToTaskThread(deps, { profile: "work", taskId: "task-1", label: "PTF-1", text: "Can we make sure this applies to games too", eventId: "e2" });
    expect(deps.revisePlan).toHaveBeenCalledWith("work", "task-1", "plan-2", "Can we make sure this applies to games too", "e2");
  });
});

describe("a question in a task thread", () => {
  const deps = (answer: SlackTaskReplyDependencies["answerQuestion"]): SlackTaskReplyDependencies => ({ state: () => ({ kind: "running" }), revisePlan: vi.fn(), saveNote: vi.fn(), answerQuestion: answer });
  const reply = (text: string) => ({ profile: "work", taskId: "task-1", label: "PTF-1", text, eventId: "e1" });

  it("is answered from the task, not saved as a note", async () => {
    const d = deps(vi.fn(async () => "You said: Games too, basically everything."));
    expect(await replyToTaskThread(d, reply("What was the answer I gave?"))).toBe("You said: Games too, basically everything.");
    expect(d.saveNote).not.toHaveBeenCalled();
  });

  it("says so when it can't answer, and still doesn't write a note", async () => {
    const d = deps(vi.fn(async () => null));
    expect(await replyToTaskThread(d, reply("why is it running?"))).toContain("couldn't answer");
    expect(d.saveNote).not.toHaveBeenCalled();
  });

  it("leaves statements and requests as notes", async () => {
    const d = deps(vi.fn(async () => "x"));
    expect(await replyToTaskThread(d, reply("Please keep the cache local"))).toContain("Saved to the task note");
    expect(d.answerQuestion).not.toHaveBeenCalled();
  });
});
