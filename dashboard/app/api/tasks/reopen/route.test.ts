import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryboardError } from "@/lib/storyboard/errors";
const mocks = vi.hoisted(() => ({ reopen: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/tasks/reopen-feedback", () => ({ reopenWithFeedback: mocks.reopen }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "./route";

function request(body: unknown, origin = "http://localhost:1342") {
  return new NextRequest("http://localhost:1342/api/tasks/reopen", { method: "POST", headers: { host: "localhost:1342", origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DEVHUB_API_SECRET", ""); mocks.reopen.mockResolvedValue({ ok: true }); });
afterEach(() => vi.unstubAllEnvs());

describe("POST task reopen", () => {
  it("rejects cross-origin requests before any mutation", async () => {
    expect((await POST(request({ id: "task" }, "https://evil.test"))).status).toBe(403);
    expect(mocks.reopen).not.toHaveBeenCalled();
  });
  it("validates arguments and passes only server-owned origin to the service", async () => {
    expect((await POST(request({ id: "../task" }))).status).toBe(400);
    expect((await POST(request({ id: "PTF-123", addressFeedback: true }))).status).toBe(200);
    expect(mocks.reopen).toHaveBeenCalledExactlyOnceWith({ taskId: "PTF-123", addressFeedback: true }, "http://localhost:1342");
  });
  it("schedules auto dispatch after the response and preserves conflict errors", async () => {
    const execute = vi.fn();
    mocks.reopen.mockResolvedValueOnce({ ok: true, execute });
    expect(await (await POST(request({ id: "task" }))).json()).toEqual({ ok: true });
    expect(mocks.after).toHaveBeenCalledWith(execute);
    expect(execute).not.toHaveBeenCalled();
    mocks.reopen.mockRejectedValueOnce(new StoryboardError("Merged PR: create a follow-up", 409));
    expect((await POST(request({ id: "task", addressFeedback: true }))).status).toBe(409);
  });
});
