import { describe, expect, it } from "vitest";
import { dashboardApiGuard } from "../../http/auth";

describe("selection credential boundary", () => {
  const authorization = "Bearer " + "x".repeat(43);
  it("delegates only the exact preview POST to workspace-token authentication", () => {
    const request = new Request("http://localhost/api/editor/incoming", { method: "POST", headers: { authorization } });
    expect(dashboardApiGuard(request).bypassAliases).toBe(true);
  });
  it.each([
    ["/api/editor/incoming", "DELETE", { authorization }],
    ["/api/editor/selection", "POST", { authorization }],
    ["/api/editor/incoming/other", "POST", { authorization }],
    ["/api/editor/incoming", "POST", {}],
    ["/api/editor/incoming", "POST", { authorization, origin: "http://evil.example" }],
  ])("keeps dashboard authentication on %s %s", (pathname, method, headers) => {
    const request = new Request("http://localhost" + pathname, { method, headers: headers as Record<string, string> });
    expect([401, 403]).toContain(dashboardApiGuard(request).response?.status);
  });
});
