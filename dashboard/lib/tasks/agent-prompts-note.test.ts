import { buildAutoImplementPrompt, buildAutoDraftPrPrompt, buildAutoFixPrompt } from "./auto-prompts";
import { describe, expect, it } from "vitest";
import { buildCreatePrPrompt } from "./create-pr-prompt";
import { buildImplementReviewPrompt } from "./implement-review-prompt";
import { buildTaskImplementPrompt, buildTaskPlanPrompt } from "./implement-prompt";
import { buildTaskAgentResumePrompt } from "./task-agent-resume";

const base = { origin: "http://127.0.0.1:1337", taskId: "task-1", date: "2026-10-17", repoName: "app", cwd: "/repo" };

/** Every prompt DevHub starts a task agent with: the agent is told to keep the task note current through task_note_update. */
const prompts: Array<[string, string]> = [
  ["auto implement", buildAutoImplementPrompt(base)],
  ["auto PR", buildAutoDraftPrPrompt(base)],
  ["auto fix", buildAutoFixPrompt({ ...base, round: 1, maxRounds: 2, findings: ["Fix layout"] })],
  ["plan", buildTaskPlanPrompt(base)],
  ["implement", buildTaskImplementPrompt(base)],
  ["resume / PR fix", buildTaskAgentResumePrompt({ ...base, handoff: "Did half of it.", priorRunId: "run-0", attention: { kind: "ci-failing", summary: "lint failed", prUrl: "https://github.com/x/app/pull/1" } })],
  ["review", buildImplementReviewPrompt({ ...base, taskText: "Fix login", notePath: "pr-reviews/app-1" })],
  ["create PR", buildCreatePrPrompt({ repoName: "app", taskId: "task-1", date: "2026-10-17" })],
];

describe("task agent prompts keep the note current", () => {
  it.each(prompts)("%s run is told to call task_note_update", (_, prompt) => {
    expect(prompt).toContain("task_note_update");
    expect(prompt).toContain("set_status_update");
    expect(prompt).toContain("summary, whatChanged, currentState, nextStep");
    expect(prompt).toContain("plan ready, implementation done, review done, failure, PR opened");
    expect(prompt).toContain("localFile");
  });

  it.each(prompts.filter(([name]) => name !== "review" && name !== "create PR"))("%s run updates status and summary as it works and tidies the note", (_, prompt) => {
    expect(prompt).toMatch(/set_status/);
    expect(prompt).toMatch(/set_summary/);
    expect(prompt).toMatch(/add_media/);
    expect(prompt).toMatch(/add_decision/);
    expect(prompt).toMatch(/Tidy as you go/);
    expect(prompt).toMatch(/remove_item or clear_section/);
  });

  it.each(prompts.filter(([name]) => name === "auto implement" || name === "auto fix"))("%s leaves the independent review to Auto", (_, prompt) => {
    expect(prompt).toContain("do not call tasks_implement_review");
    expect(prompt).toContain("after the PR step and after fixes");
    expect(prompt).toContain("preflight.md");
    expect(prompt).toContain("recovery checkpoint");
  });

  it("publishes the checked commit without another test or screenshot pass", () => {
    const prompt = buildAutoDraftPrPrompt(base);
    expect(prompt).toContain("reuse its checks and UI evidence for the unchanged commit");
    expect(prompt).toContain("Do not rerun tests, take screenshots or start another review");
    expect(prompt).toContain("Keep hooks enabled");
  });

  it.each(prompts)("%s scopes new UI captures to missing or changed evidence", (_, prompt) => {
    expect(prompt).toContain("implementation or QA stage owns UI capture");
    expect(prompt).toContain("code, checkout and scenario still match");
  });

  it("review run files its findings as bugs on the note", () => {
    expect(prompts.find(([name]) => name === "review")![1]).toMatch(/add_bug for each must-fix finding/);
  });

  it("create-PR run opens the PR ready for review and moves the card there", () => {
    const prompt = prompts.find(([name]) => name === "create PR")![1];
    expect(prompt).toMatch(/set_status ready-for-review/);
    expect(prompt).toMatch(/no `--draft` unless/);
  });
});
