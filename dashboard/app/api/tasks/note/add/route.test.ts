import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/api-utils", async (original) => ({ ...await original<typeof import("@/lib/api-utils")>(), requireDashboardAuth: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/tasks/add-user-note-server", () => ({ addTaskUserNote: vi.fn(), taskNoteCapability: vi.fn() }));

import { GET, POST } from "./route";
import { requireDashboardAuth } from "@/lib/api-utils";
import { addTaskUserNote, taskNoteCapability } from "@/lib/tasks/add-user-note-server";
import { TaskNoteOpError } from "@/lib/tasks/task-note-sections";
import { StoryboardError } from "@/lib/storyboard/errors";

const url = "http://localhost/api/tasks/note/add";
const post = (body: unknown) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());

it("passes trimmed owner text and explicit update consent to the service", async () => {
  const result = { saved: true, note: { id: "n1", text: "Keep API" }, agent: { mode: "none" as const }, capability: { running: false } };
  vi.mocked(addTaskUserNote).mockResolvedValue(result as Awaited<ReturnType<typeof addTaskUserNote>>);
  const response = await POST(post({ taskId: "PTF-1", text: " Keep API ", updateAgent: true, noteId: "n1" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(addTaskUserNote).toHaveBeenCalledWith({ taskId: "PTF-1", text: "Keep API", updateAgent: true, noteId: "n1" }, "http://localhost");
});
it("reads a task's capability without saving or touching its run", async () => {
  vi.mocked(taskNoteCapability).mockResolvedValue({ running: true, auto: false, liveFollowup: true, confirmNeeded: false, runId: "r1" });
  const response = await GET(new NextRequest(url + "?taskId=PTF-1"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ liveFollowup: true, runId: "r1" });
  expect(addTaskUserNote).not.toHaveBeenCalled();
});
it("rejects empty or oversized text before the service runs", async () => {
  for (const text of [" ", "x".repeat(4001)]) expect((await POST(post({ taskId: "t1", text }))).status).toBe(400);
  expect((await GET(new NextRequest(url))).status).toBe(400);
  expect(addTaskUserNote).not.toHaveBeenCalled();
});
it("returns read-only and missing-task errors without crashing", async () => {
  vi.mocked(addTaskUserNote).mockRejectedValueOnce(new TaskNoteOpError("Handed off and read-only"));
  const response = await POST(post({ taskId: "t1", text: "Keep API" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Handed off and read-only" });
  vi.mocked(taskNoteCapability).mockRejectedValueOnce(new StoryboardError("Task not found", 404));
  expect((await GET(new NextRequest(url + "?taskId=missing"))).status).toBe(404);
});
it("requires dashboard auth for both reads and writes", async () => {
  for (const request of [() => GET(new NextRequest(url + "?taskId=t1")), () => POST(post({ taskId: "t1", text: "Keep API" }))]) {
    vi.mocked(requireDashboardAuth).mockReturnValueOnce({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await request()).status).toBe(403);
  }
  expect(addTaskUserNote).not.toHaveBeenCalled(); expect(taskNoteCapability).not.toHaveBeenCalled();
});
