import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jira/check", () => ({
  checkJiraConnection: vi.fn(),
}));

const { checkJiraConnection } = await import("@/lib/jira/check");
const { POST } = await import("./route");

function request(body: unknown): NextRequest {
  return new NextRequest("http://test/api/setup/check/jira", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(checkJiraConnection).mockReset();
});

describe("POST /api/setup/check/jira", () => {
  it("returns auth_failed when /myself is 401", async () => {
    vi.mocked(checkJiraConnection).mockResolvedValue({
      ok: false,
      code: "auth_failed",
      message: "Jira authentication failed (HTTP 401). Mint a new API token and paste it above.",
    });
    const res = await POST(request({ apiToken: "dead-token" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: "auth_failed" }),
    );
  });

  it("returns connected when /myself is 200", async () => {
    vi.mocked(checkJiraConnection).mockResolvedValue({
      ok: true,
      code: "connected",
      message: "Connected to Jira successfully.",
    });
    const res = await POST(request({ apiToken: "live-token" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      code: "connected",
      message: "Connected to Jira successfully.",
    });
  });
});
