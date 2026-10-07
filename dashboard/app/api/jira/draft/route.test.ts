import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAiConfigured } from "@/lib/ai/preference";
import { draftJiraTicket } from "@/lib/jira/draft-ticket";
import { getTasks } from "@/lib/tasks/storage";
import { POST } from "./route";

vi.mock("@/lib/ai/preference", () => ({ isAiConfigured: vi.fn() }));
vi.mock("@/lib/ai/generate", () => ({ formatGenerateError: (error: Error) => error.message }));
vi.mock("@/lib/jira/draft-ticket", () => ({ draftJiraTicket: vi.fn(), JIRA_DRAFT_TIMEOUT_MS: 180_000 }));
vi.mock("@/lib/tasks/storage", () => ({ getTasks: vi.fn() }));

const task = { id: "task-1", text: "Fix event ordering", done: false, createdAt: "2026-10-01T12:00:00Z" };
const draft = { summary: "Handle renewal events in order", description: "Keep the most recent state.", warnings: [] };
function request(body: unknown, origin = "http://localhost:1342") {
  return new NextRequest("http://localhost:1342/api/jira/draft", {
    method: "POST",
    headers: { host: "localhost:1342", origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAiConfigured).mockReturnValue(true);
  vi.mocked(getTasks).mockReturnValue([task]);
  vi.mocked(draftJiraTicket).mockResolvedValue(draft);
});

describe("POST /api/jira/draft", () => {
  it("returns a draft without changing the task", async () => {
    const response = await POST(request({ taskId: task.id, date: "2026-10-01" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(getTasks).toHaveBeenCalledWith("2026-10-01");
    expect(draftJiraTicket).toHaveBeenCalledWith(task, "2026-10-01", expect.any(AbortSignal));
    expect(task.text).toBe("Fix event ordering");
  });

  it("rejects cross-origin generation before reading private task material", async () => {
    const response = await POST(request({ taskId: task.id, date: "2026-10-01" }, "https://elsewhere.example"));
    expect([401, 403]).toContain(response.status);
    expect(getTasks).not.toHaveBeenCalled();
    expect(draftJiraTicket).not.toHaveBeenCalled();
  });

  it.each([{ taskId: "", date: "2026-10-01" }, { taskId: task.id, date: "../../notes" }])("validates the task lookup", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(getTasks).not.toHaveBeenCalled();
  });

  it("doesn't generate for a task that doesn't exist", async () => {
    vi.mocked(getTasks).mockReturnValue([]);
    expect((await POST(request({ taskId: task.id, date: "2026-10-01" }))).status).toBe(404);
    expect(draftJiraTicket).not.toHaveBeenCalled();
  });

  it("reports missing AI configuration", async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);
    expect((await POST(request({ taskId: task.id, date: "2026-10-01" }))).status).toBe(503);
    expect(draftJiraTicket).not.toHaveBeenCalled();
  });

  it("returns a usable error when generation fails", async () => {
    vi.mocked(draftJiraTicket).mockRejectedValue(new Error("The generated Jira draft was invalid."));
    const response = await POST(request({ taskId: task.id, date: "2026-10-01" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The generated Jira draft was invalid." });
  });
});
