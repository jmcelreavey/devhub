import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-utils", async (original) => ({ ...await original<typeof import("@/lib/api-utils")>(), requireDashboardAuth: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/tasks/task-note-sections", async () => {
  const sections = await import("@shared/task-note/sections.ts");
  const update = await import("@shared/task-note/update.ts");
  return {
    TaskNoteOpError: sections.TaskNoteOpError,
    TaskNoteNotFoundError: update.TaskNoteNotFoundError,
    updateTaskNoteSections: vi.fn(),
  };
});

import { GET, POST } from "./route";
import { requireDashboardAuth } from "@/lib/api-utils";
import { TaskNoteNotFoundError, TaskNoteOpError, updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { NextResponse } from "next/server";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/tasks/note/sections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

it("passes the target and op fields through to the shared section ops", async () => {
  vi.mocked(updateTaskNoteSections).mockReturnValue({ notePath: "task-notes/x", changed: true } as ReturnType<typeof updateTaskNoteSections>);
  const res = await POST(post({ notePath: "task-notes/x", op: "set_summary", text: "hi" }));
  expect(res.status).toBe(200);
  expect(updateTaskNoteSections).toHaveBeenCalledWith({ notePath: "task-notes/x", taskId: undefined, date: undefined }, { op: "set_summary", text: "hi" });
});

it("maps a bad op to 400 and a missing note to 404", async () => {
  vi.mocked(updateTaskNoteSections).mockImplementationOnce(() => { throw new TaskNoteOpError("severity must be one of"); });
  expect((await POST(post({ notePath: "task-notes/x", op: "add_bug", title: "t", severity: "huge" }))).status).toBe(400);
  vi.mocked(updateTaskNoteSections).mockImplementationOnce(() => { throw new TaskNoteNotFoundError("nope"); });
  expect((await POST(post({ taskId: "missing", op: "read" }))).status).toBe(404);
});

it("refuses writes without dashboard auth", async () => {
  vi.mocked(requireDashboardAuth).mockReturnValueOnce({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
  expect((await POST(post({ notePath: "task-notes/x", op: "set_summary", text: "hi" }))).status).toBe(403);
  expect(updateTaskNoteSections).not.toHaveBeenCalled();
});

it("reads sections on GET and rejects a bad date", async () => {
  vi.mocked(updateTaskNoteSections).mockReturnValue({ notePath: "task-notes/x", changed: false } as ReturnType<typeof updateTaskNoteSections>);
  expect((await GET(new NextRequest("http://localhost/api/tasks/note/sections?notePath=task-notes/x"))).status).toBe(200);
  expect(updateTaskNoteSections).toHaveBeenCalledWith(expect.objectContaining({ notePath: "task-notes/x" }), { op: "read" });
  expect((await GET(new NextRequest("http://localhost/api/tasks/note/sections?taskId=t&date=16-10-2026"))).status).toBe(400);
});
