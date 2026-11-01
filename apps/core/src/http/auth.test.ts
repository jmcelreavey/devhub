import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardApiGuard } from "./auth";

function request(path: string, method: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:1437${path}`, { method, headers: { host: "localhost:1437", ...headers } });
}

describe("dashboard API guard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires origin, secret or desktop authentication for mutations", () => {
    vi.stubEnv("DEVHUB_API_SECRET", "");
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
    expect(dashboardApiGuard(request("/api/tasks", "POST")).response?.status).toBe(403);
    expect(dashboardApiGuard(request("/api/tasks", "POST", { origin: "http://other.example" })).response?.status).toBe(403);
    expect(dashboardApiGuard(request("/api/tasks", "POST", { referer: "http://localhost:1437/" })).response?.status).toBe(403);
    expect(dashboardApiGuard(request("/api/tasks", "POST", { origin: "http://localhost:1437" })).response).toBeUndefined();
    vi.stubEnv("DEVHUB_API_SECRET", "fixture-secret");
    expect(dashboardApiGuard(request("/api/tasks", "POST")).response?.status).toBe(401);
    expect(dashboardApiGuard(request("/api/tasks", "POST", { "x-devhub-secret": "fixture-secret" })).response).toBeUndefined();
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "fixture-desktop");
    expect(dashboardApiGuard(request("/api/tasks", "POST", { cookie: "devhub_desktop=fixture-desktop" })).response).toBeUndefined();
  });

  it("accepts desktop credentials on a plain Web Request", () => {
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "fixture-desktop");
    const req = new Request("http://localhost:1437/api/tasks", { method: "POST", headers: { cookie: "devhub_desktop=fixture-desktop" } });
    expect(dashboardApiGuard(req).response).toBeUndefined();
  });

  it("only bypasses aliases for the originless incoming editor bearer shape", () => {
    vi.stubEnv("DEVHUB_API_SECRET", "");
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
    const authorization = `Bearer ${"a".repeat(43)}`;
    expect(dashboardApiGuard(request("/api/editor/incoming", "POST", { authorization })).bypassAliases).toBe(true);
    expect(dashboardApiGuard(request("/api/editor/incoming", "POST", { authorization, origin: "http://other.example" })).response?.status).toBe(403);
    expect(dashboardApiGuard(request("/api/editor/incoming", "POST", { authorization: "Bearer invalid" })).response?.status).toBe(403);
    expect(dashboardApiGuard(request("/api/tasks", "POST", { authorization })).response?.status).toBe(403);
  });
});
