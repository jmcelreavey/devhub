import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeMcpAuthenticated, runtimeMcpServers } from "./runtime-mcp";

vi.mock("./context", () => ({ pluginContext: () => ({}) }));
vi.mock("./runtime-host", () => ({
  runtimeCatalog: () => [{ name: "sample-tools", runtime: { mcp: [{ name: "sample" }] } }],
}));

afterEach(() => vi.unstubAllEnvs());

function request(token?: string, host = "127.0.0.1:1337") {
  return new NextRequest(`http://${host}/api/plugins/runtime/sample-tools/mcp/sample`, {
    method: "POST", headers: { host, ...(token ? { "x-devhub-plugin-token": token } : {}) },
  });
}

it("authenticates only the named plugin and server without sharing the app credential", () => {
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "test-bootstrap-credential");
  vi.stubEnv("PORT", "1337");
  const config = runtimeMcpServers()["plugin-sample-tools-sample"];
  const token = config.headers["x-devhub-plugin-token"];
  expect(config.url).toBe("http://127.0.0.1:1337/api/plugins/runtime/sample-tools/mcp/sample");
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(config)).not.toContain("test-bootstrap-credential");
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "sample")).toBe(true);
  expect(runtimeMcpAuthenticated(request(token), "other-plugin", "sample")).toBe(false);
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "other-server")).toBe(false);
  expect(runtimeMcpAuthenticated(request(token, "example.invalid"), "sample-tools", "sample")).toBe(false);
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "rotated-test-credential");
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "sample")).toBe(false);
});

it("fails closed for absent and malformed credentials", () => {
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "test-bootstrap-credential");
  for (const value of [undefined, "short", "z".repeat(64), "a".repeat(64)]) {
    expect(runtimeMcpAuthenticated(request(value), "sample-tools", "sample")).toBe(false);
  }
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  vi.stubEnv("DEVHUB_API_SECRET", "");
  expect(runtimeMcpServers()["plugin-sample-tools-sample"].headers).not.toHaveProperty("x-devhub-plugin-token");
  expect(runtimeMcpAuthenticated(request("a".repeat(64)), "sample-tools", "sample")).toBe(false);
});
