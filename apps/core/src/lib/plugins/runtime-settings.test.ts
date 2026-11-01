import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readDashboardEnvLocalFile } from "../dashboard-env-local";
import { runtimeSchema, runtimeInventory } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { prepareRuntimeSettings } from "./runtime-settings";
import { runtimeEnvironmentValues } from "./runtime-environment";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-settings-")));
  roots.push(root);
  const file = path.join(root, "app", "settings.env");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, "AWS_PROFILE=dev-example\nJIRA_API_TOKEN=retained-fixture-value\nEXTRA=keep\n");
  vi.stubEnv("DEVHUB_ENV_FILE", file);
  vi.stubEnv("AWS_PROFILE", "dev-example");
  const runtime = runtimeSchema.parse({ api: "1", transport: "request-worker", entry: "worker.mjs", sha256: "a".repeat(64), lockfile: { path: "package-lock.json", sha256: "b".repeat(64) }, pages: [], mcp: [], routes: [{ path: "/profile", method: "POST" }], capabilities: { settings: [{ path: "/profile", keys: ["AWS_PROFILE"] }] }, permissions: { env: [], publicEnv: ["AWS_PROFILE"], network: [], exec: false } });
  return { file, runtime, request: { kind: "api", method: "POST", path: "/profile" } as const };
}

it("persists only the reviewed patch, retains other settings and returns only the action result", () => {
  const { runtime, request } = fixture();
  const apply = prepareRuntimeSettings(runtime, request, process.env);
  expect(apply({ ok: true, hostSettings: { AWS_PROFILE: "prd-example+" }, profile: "prd-example+" }, () => true)).toEqual({ ok: true, profile: "prd-example+" });
  expect(readDashboardEnvLocalFile()).toEqual({ overrides: new Map([["AWS_PROFILE", "prd-example+"], ["JIRA_API_TOKEN", "retained-fixture-value"]]), passthrough: ["EXTRA=keep"] });
  expect(process.env.AWS_PROFILE).toBe("prd-example+");
  expect(runtimeInventory(runtime).find(group => group.kind === "Host setting writes")?.entries[0]).toContain("POST /profile: AWS_PROFILE");
});

it("refuses unreviewed, failed, malformed, cancelled and concurrent changes without touching the file", () => {
  const { file, runtime, request } = fixture();
  const before = fs.readFileSync(file);
  for (const output of [
    { ok: false, hostSettings: { AWS_PROFILE: "prd-example+" } },
    { ok: true, hostSettings: { AWS_PROFILE: "dev\nNODE_OPTIONS=bad" } },
    { ok: true, hostSettings: { JIRA_API_TOKEN: "bad" } },
    { ok: true, hostSettings: {} },
  ]) expect(() => prepareRuntimeSettings(runtime, request, process.env)(output, () => true)).toThrow();
  const output = { ok: true, hostSettings: { AWS_PROFILE: "sbx-example" } };
  expect(() => prepareRuntimeSettings(runtime, { ...request, method: "GET" }, process.env)(output, () => true)).toThrow();
  expect(() => prepareRuntimeSettings(runtime, request, { NODE_ENV: "test" })(output, () => true)).toThrow();
  expect(() => prepareRuntimeSettings(runtime, request, process.env)(output, () => false)).toThrow();
  expect(fs.readFileSync(file)).toEqual(before);
  const apply = prepareRuntimeSettings(runtime, request, process.env);
  fs.writeFileSync(file, "AWS_PROFILE=prd-other\n");
  expect(() => apply(output, () => true)).toThrow(/changed/);
  expect(fs.readFileSync(file, "utf8")).toBe("AWS_PROFILE=prd-other\n");
});

it("requires a public setting and a non-streaming POST route, with unknown keys failing closed", () => {
  const { runtime } = fixture();
  for (const candidate of [
    { ...runtime, permissions: { ...runtime.permissions, publicEnv: [] } },
    { ...runtime, routes: [{ path: "/profile", method: "GET" }] },
    { ...runtime, routes: [{ path: "/profile", method: "POST", stream: true }] },
    { ...runtime, capabilities: { settings: [{ path: "/profile", keys: ["NODE_OPTIONS"] }] } },
    { ...runtime, capabilities: { settings: [{ path: "/profile", keys: ["OKTA_PASSWORD"] }] } },
  ]) expect(runtimeSchema.safeParse(candidate).success).toBe(false);
});

it("persists reviewed legacy setting responses and clears only the requested profile", () => {
  const { runtime, request } = fixture();
  vi.stubEnv("SERVICE_USER_EMAIL", "before@example.invalid");
  const expanded = runtimeSchema.parse({
    ...runtime,
    routes: [...runtime.routes, { path: "/profile", method: "DELETE" }, { path: "/user-email", method: "POST" }],
    capabilities: { settings: [
      { path: "/profile", keys: ["AWS_PROFILE"] },
      { path: "/profile", method: "DELETE", keys: ["AWS_PROFILE"] },
      { path: "/user-email", keys: ["SERVICE_USER_EMAIL"] },
    ] },
    permissions: { ...runtime.permissions, publicEnv: ["AWS_PROFILE", "SERVICE_USER_EMAIL"] },
  });
  const setEmail = prepareRuntimeSettings(expanded, { ...request, path: "/user-email" }, process.env);
  expect(setEmail({ status: 200, body: { email: "after@example.invalid" }, hostSettings: { SERVICE_USER_EMAIL: "after@example.invalid" } }, () => true))
    .toEqual({ status: 200, body: { email: "after@example.invalid" } });
  expect(readDashboardEnvLocalFile(["SERVICE_USER_EMAIL"]).overrides.get("SERVICE_USER_EMAIL")).toBe("after@example.invalid");
  expect(process.env.SERVICE_USER_EMAIL).toBe("after@example.invalid");
  delete process.env.SERVICE_USER_EMAIL;
  expect(runtimeEnvironmentValues(expanded, process.env).SERVICE_USER_EMAIL).toBe("after@example.invalid");
  const clear = prepareRuntimeSettings(expanded, { ...request, method: "DELETE" }, process.env);
  expect(clear({ status: 200, body: { ok: true }, hostSettings: { AWS_PROFILE: null } }, () => true))
    .toEqual({ status: 200, body: { ok: true } });
  expect(readDashboardEnvLocalFile().overrides.has("AWS_PROFILE")).toBe(false);
  expect(process.env.AWS_PROFILE).toBeUndefined();
  expect(readDashboardEnvLocalFile(["SERVICE_USER_EMAIL"]).overrides.get("SERVICE_USER_EMAIL")).toBe("after@example.invalid");
  expect(runtimeInventory(expanded).find(group => group.kind === "Host setting writes")?.entries).toContainEqual(expect.stringContaining("DELETE /profile: AWS_PROFILE"));
});

it("refuses malformed, failed or unreviewed legacy setting writes", () => {
  const { file, runtime, request } = fixture();
  const expanded = runtimeSchema.parse({
    ...runtime,
    routes: [...runtime.routes, { path: "/profile", method: "DELETE" }, { path: "/user-email", method: "POST" }],
    capabilities: { settings: [
      { path: "/profile", keys: ["AWS_PROFILE"] },
      { path: "/profile", method: "DELETE", keys: ["AWS_PROFILE"] },
      { path: "/user-email", keys: ["SERVICE_USER_EMAIL"] },
    ] },
    permissions: { ...runtime.permissions, publicEnv: ["AWS_PROFILE", "SERVICE_USER_EMAIL"] },
  });
  const before = fs.readFileSync(file);
  const profile = prepareRuntimeSettings(expanded, request, process.env);
  expect(() => profile({ ok: true, hostSettings: { AWS_PROFILE: null } }, () => true)).toThrow();
  expect(() => profile({ status: 400, body: {}, hostSettings: { AWS_PROFILE: "sbx-example" } }, () => true)).toThrow();
  expect(() => profile({ status: 200, body: { ok: false }, hostSettings: { AWS_PROFILE: "sbx-example" } }, () => true)).toThrow();
  expect(() => profile({ status: 200, body: {}, extra: true, hostSettings: { AWS_PROFILE: "sbx-example" } }, () => true)).toThrow();
  const email = prepareRuntimeSettings(expanded, { ...request, path: "/user-email" }, process.env);
  expect(() => email({ status: 200, body: {}, hostSettings: { SERVICE_USER_EMAIL: "x\nAWS_PROFILE=prd" } }, () => true)).toThrow();
  expect(() => email({ status: 200, body: {}, hostSettings: { AWS_PROFILE: "sbx-example" } }, () => true)).toThrow();
  expect(fs.readFileSync(file)).toEqual(before);
  expect(runtimeSchema.safeParse({ ...expanded, routes: runtime.routes }).success).toBe(false);
});

it("persists only confirmed-slot grants, retains unrelated settings and strips credential patches", () => {
  const { runtime } = fixture();
  vi.stubEnv("SLACK_BOT_TOKEN", "fixture-before");
  const expanded = runtimeSchema.parse({
    ...runtime,
    capabilities: {
      slots: [{ id: "team-setup", location: "setup", label: "Team", routes: [{ path: "/settings", method: "POST", confirmation: "Save settings?" }] }],
      settings: [{ slot: "team-setup", path: "/settings", method: "POST", keys: ["SLACK_BOT_TOKEN", "SLACK_TRANSPORT"], credentials: true, clear: true }],
    },
    permissions: { ...runtime.permissions, env: ["SLACK_BOT_TOKEN"], publicEnv: ["SLACK_TRANSPORT"] },
  });
  const request = { kind: "slot", path: "team-setup", method: "POST", body: { action: { path: "/settings", method: "POST" } } } as const;
  const apply = prepareRuntimeSettings(expanded, request, process.env);
  expect(apply({ ok: true, previous: "fixture-before", next: "fixture-after", hostSettings: { SLACK_BOT_TOKEN: "fixture-after", SLACK_TRANSPORT: "direct" } }, () => true))
    .toEqual({ ok: true, previous: "[redacted]", next: "[redacted]" });
  expect(runtimeEnvironmentValues(expanded, process.env)).toMatchObject({ SLACK_BOT_TOKEN: "fixture-after", SLACK_TRANSPORT: "direct" });
  expect(readDashboardEnvLocalFile().overrides.get("AWS_PROFILE")).toBe("dev-example");
  expect(runtimeInventory(expanded).find(group => group.kind === "Host setting writes")?.entries[0]).toContain("may update credentials");
  const clear = prepareRuntimeSettings(expanded, request, process.env);
  expect(clear({ ok: true, removed: "fixture-after", hostSettings: { SLACK_BOT_TOKEN: null } }, () => true)).toEqual({ ok: true, removed: "[redacted]" });
  expect(readDashboardEnvLocalFile().overrides.has("SLACK_BOT_TOKEN")).toBe(false);
  expect(process.env.SLACK_BOT_TOKEN).toBeUndefined();
});

it("rejects unreviewed slot settings, cancellations and concurrent changes", () => {
  const { file, runtime } = fixture();
  const expanded = runtimeSchema.parse({
    ...runtime,
    capabilities: {
      slots: [{ id: "team-setup", location: "setup", label: "Team", routes: [{ path: "/settings", method: "POST", confirmation: "Save settings?" }] }],
      settings: [{ slot: "team-setup", path: "/settings", method: "POST", keys: ["SLACK_BOT_TOKEN"], credentials: true, clear: false }],
    },
    permissions: { ...runtime.permissions, env: ["SLACK_BOT_TOKEN"] },
  });
  const request = { kind: "slot", path: "team-setup", method: "POST", body: { action: { path: "/settings", method: "POST" } } } as const;
  const output = { ok: true, hostSettings: { SLACK_BOT_TOKEN: "fixture-next" } };
  const before = fs.readFileSync(file);
  expect(() => prepareRuntimeSettings(expanded, { ...request, path: "other" }, process.env)(output, () => true)).toThrow();
  expect(() => prepareRuntimeSettings(expanded, { ...request, body: { action: { path: "/other", method: "POST" } } }, process.env)(output, () => true)).toThrow();
  expect(() => prepareRuntimeSettings(expanded, request, process.env)({ ok: true, hostSettings: { SLACK_BOT_TOKEN: null } }, () => true)).toThrow();
  expect(() => prepareRuntimeSettings(expanded, request, process.env)(output, () => false)).toThrow();
  expect(fs.readFileSync(file)).toEqual(before);
  const apply = prepareRuntimeSettings(expanded, request, process.env);
  fs.appendFileSync(file, "\nSLACK_BOT_TOKEN=fixture-concurrent\n");
  expect(() => apply(output, () => true)).toThrow(/changed/);
  for (const candidate of [
    { ...expanded, permissions: { ...expanded.permissions, env: [] } },
    { ...expanded, capabilities: { ...expanded.capabilities, settings: [{ slot: "other", path: "/settings", method: "POST", keys: ["SLACK_BOT_TOKEN"], credentials: true, clear: false }] } },
    { ...expanded, capabilities: { ...expanded.capabilities, settings: [{ slot: "team-setup", path: "/settings", method: "POST", keys: ["SLACK_BOT_TOKEN"], credentials: false, clear: false }] } },
  ]) expect(runtimeSchema.safeParse(candidate).success).toBe(false);
});

function mcpFixture() {
  const { file, runtime } = fixture();
  const expanded = runtimeSchema.parse({
    ...runtime,
    mcp: [{ name: "ops", description: "Example operations" }],
    capabilities: { settings: [
      { path: "/profile", keys: ["AWS_PROFILE"] },
      { server: "ops", tool: "ops_switch_profile", keys: ["AWS_PROFILE"], clear: false },
      { server: "ops", tool: "ops_clear_profile", keys: ["AWS_PROFILE"], clear: true },
    ] },
  });
  const request = { kind: "mcp", path: "ops", method: "POST", body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ops_switch_profile" } } } as const;
  return { file, runtime: expanded, request };
}

it("persists only successful reviewed MCP tool patches and strips them from the reply", () => {
  const { runtime, request } = mcpFixture();
  const result = { content: [{ type: "text", text: "Switched." }] };
  const apply = prepareRuntimeSettings(runtime, request, process.env);
  expect(apply({ jsonrpc: "2.0", id: 7, result, hostSettings: { AWS_PROFILE: "sbx-example" } }, () => true)).toEqual({ jsonrpc: "2.0", id: 7, result });
  expect(readDashboardEnvLocalFile().overrides.get("AWS_PROFILE")).toBe("sbx-example");
  const clearRequest = { ...request, body: { ...request.body, id: "clear", params: { name: "ops_clear_profile" } } };
  const clear = prepareRuntimeSettings(runtime, clearRequest, process.env);
  expect(clear({ jsonrpc: "2.0", id: "clear", result, hostSettings: { AWS_PROFILE: null } }, () => true)).toEqual({ jsonrpc: "2.0", id: "clear", result });
  expect(readDashboardEnvLocalFile().overrides.has("AWS_PROFILE")).toBe(false);
  expect(process.env.AWS_PROFILE).toBeUndefined();
  expect(runtimeInventory(runtime).find(group => group.kind === "Host setting writes")?.entries).toContainEqual(expect.stringContaining("MCP ops · tool ops_clear_profile: AWS_PROFILE · may clear settings"));
});

it("refuses forged, failed, cancelled and concurrent MCP settings writes", () => {
  const { file, runtime, request } = mcpFixture();
  const before = fs.readFileSync(file);
  const result = { content: [{ type: "text", text: "Switched." }] };
  const output = { jsonrpc: "2.0", id: 7, result, hostSettings: { AWS_PROFILE: "sbx-example" } };
  for (const invalid of [
    { ...request, path: "other" },
    { ...request, method: "GET" },
    { ...request, body: { ...request.body, method: "tools/list" } },
    { ...request, body: { ...request.body, params: { name: "ops_status" } } },
    { ...request, body: { ...request.body, id: null } },
    { ...request, body: { ...request.body, id: undefined } },
  ]) expect(() => prepareRuntimeSettings(runtime, invalid, process.env)(output, () => true)).toThrow();
  const apply = prepareRuntimeSettings(runtime, request, process.env);
  for (const invalid of [
    { ...output, id: 8 },
    { ...output, jsonrpc: "1.0" },
    { ...output, result: { ...result, isError: true } },
    { ...output, result: { content: [{ type: "text" }] } },
    { ...output, error: { code: -1, message: "failed" } },
    { ...output, hostSettings: { AWS_PROFILE: null } },
    { ...output, hostSettings: { SERVICE_USER_EMAIL: "other@example.invalid" } },
  ]) expect(() => apply(invalid, () => true)).toThrow();
  expect(() => apply(output, () => false)).toThrow();
  expect(fs.readFileSync(file)).toEqual(before);
  fs.writeFileSync(file, "AWS_PROFILE=prd-other\n");
  expect(() => apply(output, () => true)).toThrow(/changed/);
  expect(fs.readFileSync(file, "utf8")).toBe("AWS_PROFILE=prd-other\n");
});

it("requires distinct reviewed MCP servers, tools and public setting grants", () => {
  const { runtime } = mcpFixture();
  const mcp = { server: "ops", tool: "ops_switch_profile", keys: ["AWS_PROFILE"], clear: false };
  for (const candidate of [
    { ...runtime, mcp: [] },
    { ...runtime, permissions: { ...runtime.permissions, publicEnv: [] } },
    { ...runtime, capabilities: { settings: [mcp, mcp] } },
    { ...runtime, capabilities: { settings: [{ ...mcp, tool: "../bad" }] } },
    { ...runtime, capabilities: { settings: [{ ...mcp, keys: ["NODE_OPTIONS"] }] } },
    { ...runtime, capabilities: { settings: [{ ...mcp, keys: ["OKTA_PASSWORD"] }] } },
    { ...runtime, capabilities: { settings: [{ ...mcp, credentials: true }] } },
  ]) expect(runtimeSchema.safeParse(candidate).success).toBe(false);
});
