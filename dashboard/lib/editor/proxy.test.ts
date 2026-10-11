import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/api-utils", () => ({ requireDashboardAuth: () => ({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }) }));
import { proxy } from "../../proxy";
describe("selection credential boundary", () => {
  const authorization = "Bearer " + "x".repeat(43);
  it("delegates only the exact preview POST to workspace-token authentication", () => {
    const request = new NextRequest("http://localhost/api/editor/incoming", { method: "POST", headers: { authorization } });
    expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });
  it.each([
    ["/api/editor/incoming", "DELETE", { authorization }],
    ["/api/editor/selection", "POST", { authorization }],
    ["/api/editor/incoming/other", "POST", { authorization }],
    ["/api/editor/incoming", "POST", {}],
    ["/api/editor/incoming", "POST", { authorization, origin: "http://localhost" }],
  ])("keeps dashboard authentication on %s %s", (pathname, method, headers) => {
    expect(proxy(new NextRequest("http://localhost" + pathname, { method, headers: headers as Record<string, string> })).status).toBe(401);
  });
});
