import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAiConfigured } from "@/lib/ai/preference";
import { DraftStepError, DRAFT_NDJSON_TYPE, type DraftEvent } from "@/lib/jira/draft-events";
import { draftJiraTicket } from "@/lib/jira/draft-ticket";
import { getTasks } from "@/lib/tasks/storage";
import { POST } from "./route";

vi.mock("@/lib/ai/preference", () => ({ isAiConfigured: vi.fn() }));
vi.mock("@/lib/ai/generate", () => ({ formatGenerateError: (error: Error) => error.message }));
vi.mock("@/lib/jira/draft-ticket", () => ({ draftJiraTicket: vi.fn(), JIRA_DRAFT_TIMEOUT_MS: 180_000 }));
vi.mock("@/lib/tasks/storage", () => ({ getTasks: vi.fn() }));

const task = { id: "task-1", text: "Fix event ordering", done: false, createdAt: "2026-10-01T12:00:00Z" };
const draft = { summary: "Handle renewal events in order", description: "Keep the most recent state.", warnings: [] };
function request(body: unknown, origin = "http://localhost:1342", accept = "application/json") {
  return new NextRequest("http://localhost:1342/api/jira/draft", {
    method: "POST",
    headers: { host: "localhost:1342", origin, "Content-Type": "application/json", Accept: accept },
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

  it("streams steps, partial text and the finished draft as NDJSON", async () => {
    vi.mocked(draftJiraTicket).mockImplementation(async (_task, _date, _signal, onEvent) => {
      const events: DraftEvent[] = [
        { type: "step", step: "context", status: "running", at: 1 },
        { type: "step", step: "context", status: "done", at: 2 },
        { type: "partial", summary: "So far", description: "" },
      ];
      for (const event of events) onEvent?.(event);
      return draft;
    });
    const response = await POST(request({ taskId: task.id, date: "2026-10-01" }, "http://localhost:1342", DRAFT_NDJSON_TYPE));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(DRAFT_NDJSON_TYPE);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as DraftEvent);
    expect(events.map((event) => event.type)).toEqual(["step", "step", "partial", "result"]);
    expect(events.at(-1)).toMatchObject({ type: "result", draft, totalMs: expect.any(Number) });
  });

  it("reports a failed step on the stream", async () => {
    vi.mocked(draftJiraTicket).mockImplementation(async (_task, _date, _signal, onEvent) => {
      onEvent?.({ type: "step", step: "draft", status: "running", at: 5 });
      onEvent?.({ type: "step", step: "draft", status: "error", at: 9, detail: "The model failed." });
      throw new DraftStepError("draft", new Error("The model failed."));
    });
    const response = await POST(request({ taskId: task.id, date: "2026-10-01" }, "http://localhost:1342", DRAFT_NDJSON_TYPE));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as DraftEvent);
    expect(events.map((event) => event.type === "step" ? `${event.step}:${event.status}` : event.type)).toEqual([
      "draft:running",
      "draft:error",
      "error",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "error", step: "draft", message: "The model failed." });
  });

  it("stops drafting when the client disconnects", async () => {
    const abort = new AbortController();
    let seen: AbortSignal | undefined;
    vi.mocked(draftJiraTicket).mockImplementation((_task, _date, signal) => {
      seen = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError")));
      });
    });
    const pending = POST(new NextRequest("http://localhost:1342/api/jira/draft", {
      method: "POST",
      signal: abort.signal,
      headers: { host: "localhost:1342", origin: "http://localhost:1342", "Content-Type": "application/json", Accept: DRAFT_NDJSON_TYPE },
      body: JSON.stringify({ taskId: task.id, date: "2026-10-01" }),
    }));
    await vi.waitFor(() => expect(seen).toBeInstanceOf(AbortSignal));
    abort.abort();
    const response = await pending;
    expect(seen?.aborted).toBe(true);
    expect((await response.text()).trim()).toBe("");
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
