import { describe, expect, it } from "vitest";
import { buildTaskPlanPrompt, buildTaskImplementPrompt, taskImplementPlanUrl } from "./implement-prompt";

describe("buildTaskImplementPrompt", () => {
  it("points the skill at the encoded task plan and post-implementation gates", () => {
    const prompt = buildTaskImplementPrompt({
      origin: "http://localhost:1337/",
      taskId: "task / 1",
      date: "2026-08-25",
      repoName: "example-org/app-poc",
    });

    expect(prompt).toContain("devhub-implement-task");
    expect(prompt).toContain("example-org/app-poc");
    expect(prompt).toContain(
      "http://localhost:1337/api/tasks/implement/plan?taskId=task%20%2F%201&date=2026-08-25",
    );
    expect(prompt).not.toContain("tags_lookup");
    expect(prompt).toContain("Do not create a clone or worktree by default");
    expect(prompt).toContain("ask before using a worktree");
    expect(prompt).toContain("local commits directly in your own shell without proposing them for approval");
  });

  it("records explicit chat approval without requiring a second UI decision", () => {
    const prompt = buildTaskImplementPrompt({ origin: "http://localhost:1337", taskId: "task-1", date: "2026-10-19" });

    expect(prompt).toContain("Reuse approval I have already given in this conversation");
    expect(prompt).toContain("An explicit request to create the PR includes pushing the reviewed changes as needed");
    expect(prompt).toContain("Jira transitions and task completion need their own explicit approval");
    expect(prompt).toContain("record the user's instruction in the task note");
    expect(prompt).toContain("POST action: decide with proposalId and approve: true");
    expect(prompt).toContain("Never approve an action the user has not authorised");
    expect(prompt).toContain("changed scope needs fresh approval");
    expect(prompt).toContain("POST action: begin");
    expect(prompt).toContain("action: receipt");
    expect(prompt).not.toContain("Wait for the human decision in DevHub");
  });

  it("carries the picked repo on the plan URL so the plan route starts there", () => {
    const withRepo = taskImplementPlanUrl({
      origin: "http://localhost:1337",
      taskId: "task-1",
      date: "2026-08-27",
      repoName: "example-org/app",
    });
    expect(withRepo).toContain("&repo=example-org%2Fapp");
    expect(
      taskImplementPlanUrl({ origin: "http://localhost:1337", taskId: "task-1", date: "2026-08-27" }),
    ).not.toContain("repo=");
  });

  it("pins the checkout and Jira key when the hub supplies them", () => {
    const prompt = buildTaskImplementPrompt({
      origin: "http://localhost:1337",
      taskId: "task-1",
      date: "2026-08-27",
      repoName: "app-poc",
      cwd: "/repos/app-poc",
      jiraKey: "PTF-4783",
    });
    expect(prompt).toContain("Working tree: /repos/app-poc");
    expect(prompt).toContain("Jira ticket: PTF-4783");
  });
});

describe("task note maintenance", () => {
  it("tells implement agents to maintain the note through task_note_update", () => {
    const prompt = buildTaskImplementPrompt({ origin: "http://localhost:1337", taskId: "t1", date: "2026-10-16" } as Parameters<typeof buildTaskImplementPrompt>[0]);
    expect(prompt).toContain("task_note_update");
    expect(prompt).toContain("/api/tasks/note/sections");
  });
});

it("tells a paused Auto planner to leave approval to the user", () => {
  const prompt = buildTaskPlanPrompt({ origin: "http://fixture", taskId: "t", date: "2026-10-19", pauseAfterPlan: true });
  expect(prompt).toContain("Pause after planning is on");
  expect(prompt).toContain("never approve your own plan");
  expect(prompt).toContain("Next step: Approve plan or Revise");
});
