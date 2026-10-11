import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/api-utils", () => ({ requireDashboardAuth: mocks.auth }));
vi.mock("@/lib/scripts-runner", () => ({ startRun: mocks.start, getScriptCatalog: vi.fn(), getAllowedScripts: vi.fn() }));
function request(dryRun: unknown = true): NextRequest {
  return new NextRequest("http://localhost/api/scripts", { method: "POST", body: JSON.stringify({ script: "worktree_cleanup", dryRun }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue({ ok: true }); mocks.start.mockReturnValue({ runId: "cleanup" }); });
describe("worktree cleanup dry-run API", () => {
  it.each([true, false])("passes the exact dryRun boolean: %s", async (dryRun) => {
    expect((await POST(request(dryRun))).status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith("worktree_cleanup", { dryRun });
  });
  it.each(["true", "false", 1, null])("rejects invalid dryRun rather than deleting: %s", async (dryRun) => {
    expect((await POST(request(dryRun))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("requires dashboard authentication", async () => {
    mocks.auth.mockReturnValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
