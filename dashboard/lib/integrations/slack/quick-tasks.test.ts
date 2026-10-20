import { describe, expect, it } from "vitest";
import { formatTaskChange, parseCaptured, QUICK_TOOLS, taskHref, UNDO_TOOLS, updatedTaskTitle } from "./quick-tasks";

describe("what may skip Confirm", () => {
  it("is exactly the task update and capture, and Undo may only run the task update and delete", () => {
    expect([...QUICK_TOOLS].sort()).toEqual(["task_reopen", "tasks_capture", "tasks_update"]);
    expect([...UNDO_TOOLS].sort()).toEqual(["tasks_delete", "tasks_update"]);
  });
});

describe("formatTaskChange", () => {
  const base = { title: "Fix the ad slot", taskId: "task 1", profile: "work", channel: "C", threadTs: "1.1" };
  it.each([["done", "✅ Done"], ["reopened", "↩️ Task reopened"], ["added", "➕ Saved to To do"]] as const)("%s: one line, Undo and Open", (change, headline) => {
    const message = formatTaskChange({ ...base, change, undoId: "u1" });
    expect(message.text).toBe(`${headline} · Fix the ad slot`);
    expect(message.thread_ts).toBe("1.1");
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ action_id: string; text: { text: string }; style?: string; value?: string; url?: string }>;
    expect(buttons.map((button) => [button.action_id, button.text.text, button.style])).toEqual([["devhub_tool_undo", "Undo", undefined], ["devhub_open", "Open in DevHub", "primary"]]);
    expect(buttons[0].value).toBe("u1");
    expect(buttons[1].url).toBe(taskHref("task 1", "work"));
    expect(taskHref("task 1", "work")).toBe("http://localhost:1337/storyboard?task=task%201&profile=work");
  });
  it("omits Undo, and its promise, when there is nothing to undo with", () => {
    const body = JSON.stringify(formatTaskChange({ ...base, change: "done" }).blocks);
    expect(body).not.toContain("devhub_tool_undo");
    expect(body).not.toContain("Undo is good");
  });
  it("says an added task is a draft that started nothing, and keeps titles from linking or mentioning", () => {
    const body = JSON.stringify(formatTaskChange({ ...base, change: "added", title: "<!channel> <https://evil.test|x>", undoId: "u" }).blocks);
    expect(body).toContain("Draft in To do. No agent started.");
    expect(body).not.toContain("<!channel>");
    expect(body).not.toContain("<https://evil.test|x>");
  });
});

describe("reading the MCP tools' replies", () => {
  it("parses a capture", () => {
    expect(parseCaptured("Captured draft abc-1 on 2026-10-18: Renew the cert\nNote: task-notes/x\nContext: 0 note(s).")).toEqual({ taskId: "abc-1", date: "2026-10-18", title: "Renew the cert" });
    expect(parseCaptured("Task not found")).toBeUndefined();
  });
  it("parses an update's title", () => {
    expect(updatedTaskTitle("Updated task: abc-1 — Fix the ad slot — urgent (done=true, stage=ready)")).toBe("Fix the ad slot — urgent");
    expect(updatedTaskTitle("Task not found: abc-1")).toBeUndefined();
  });
});
