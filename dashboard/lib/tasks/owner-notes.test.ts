import { describe, expect, it, vi } from "vitest";
import { buildTaskPlanPrompt, buildTaskImplementPrompt } from "./implement-prompt";
import { buildAutoImplementPrompt, buildAutoFixPrompt, buildAutoDraftPrPrompt } from "./auto-prompts";
import { buildImplementReviewPrompt } from "./implement-review-prompt";
import { buildTaskAgentResumePrompt } from "./task-agent-resume";
import { buildFeedbackPrompt } from "./feedback-prompt";
import { withTaskOwnerNotes } from "./owner-notes-server";
import { renderOwnerNotes } from "./owner-notes";

const notes = [{ id: "owner-1", text: "Use the existing client.\nDo not replace the API.", at: "2026-10-19T10:00:00.000Z" }];
vi.mock("./task-note-sections", () => ({
  TaskNoteNotFoundError: class extends Error {},
  updateTaskNoteSections: () => ({ view: { userNotes: [{ id: "owner-1", text: "Use the existing client.\nDo not replace the API.", at: "2026-10-19T10:00:00.000Z" }] } }),
}));
const base = { taskId: "t1", date: "2026-10-19", origin: "http://localhost:1337", cwd: "/repo" };
const prompts = [
  ["plan", buildTaskPlanPrompt(base)], ["implement", buildTaskImplementPrompt(base)],
  ["auto implement", buildAutoImplementPrompt(base)], ["auto PR", buildAutoDraftPrPrompt(base)],
  ["auto fix", buildAutoFixPrompt({ ...base, round: 1, maxRounds: 2, findings: [] })],
  ["review", buildImplementReviewPrompt({ ...base, taskText: "Fix API", notePath: "pr-reviews/t1" })],
  ["feedback / reopen", buildFeedbackPrompt({ taskId: "t1", brief: "Review feedback", statusInstruction: "Status" })],
  ["resume", buildTaskAgentResumePrompt({ ...base, handoff: "Keep working" })],
];
describe("task briefs retain owner instructions", () => {
  it.each(prompts)("%s receives fresh notes at delivery without trimming them", (_name, prompt) => {
    expect(prompt).toContain("Your notes");
    const delivered = withTaskOwnerNotes(prompt, "t1");
    expect(delivered).toContain(renderOwnerNotes(notes)); expect(delivered).toContain("instructions from the task owner");
    expect(delivered).toContain(notes[0].text);
  });
  it("leaves non-task dispatches untouched", () => expect(withTaskOwnerNotes("Other prompt")).toBe("Other prompt"));
});
