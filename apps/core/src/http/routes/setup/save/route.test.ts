import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  providers: [] as Array<{ id: string; setupStatus?: () => unknown }>,
  overrides: new Map<string, string>(),
  read: vi.fn(),
  write: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("../../../../lib/integrations/registry", () => ({ providers: () => fixture.providers }));
vi.mock("../../../../lib/dashboard-env-local", () => ({
  getPackagedUserEnvFilePath: () => null,
  patchEnvFileKeys: vi.fn(),
  readDashboardEnvLocalFile: () => {
    fixture.read();
    return { overrides: fixture.overrides, passthrough: [] };
  },
  syncAgentProcessEnvFromOverrides: fixture.sync,
  syncPaseoProcessEnvFromOverrides: fixture.sync,
  syncInfraProcessEnvFromOverrides: fixture.sync,
  syncDatadogProcessEnvFromOverrides: fixture.sync,
  syncGoogleProcessEnvFromOverrides: fixture.sync,
  syncJiraProcessEnvFromOverrides: fixture.sync,
  syncQaProcessEnvFromOverrides: fixture.sync,
  writeDashboardEnvLocalFile: fixture.write,
}));
vi.mock("../../../../lib/agent/cli-env", () => ({ normalizeAgentCli: (value: string) => value }));
vi.mock("../../../../lib/ai/preference", () => ({
  normalizeAiProvider: (value: string) => value,
  toAgentLaunchCli: (value: string) => value,
}));
vi.mock("../../../../lib/plugin-integration-hooks", () => ({
  applyOptionalIntegrationSettings: vi.fn(),
  activateOptionalIntegrationSettings: vi.fn(),
  isOptionalIntegrationAvailable: () => false,
  optionalIntegrationSavedMessage: "",
}));
vi.mock("../../../../lib/jira/tickets-cache", () => ({ invalidateJiraTicketsCache: vi.fn() }));

import { POST } from "./route";

function save(body: unknown) {
  return POST(new Request("http://localhost/api/setup/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function validStatus() {
  return {
    configured: true,
    fields: {
      hasApiKey: true,
      hasApplicationKey: true,
      hasEmail: true,
      hasScheduleId: true,
      email: "person@example.invalid",
      scheduleId: "saved-schedule",
      appOrigin: "https://app.example.invalid",
    },
  };
}

describe("setup saves with an optional Datadog provider", () => {
  beforeEach(() => {
    fixture.providers.length = 0;
    fixture.overrides.clear();
    fixture.overrides.set("DATADOG_API_KEY", "synthetic-api-secret");
    fixture.overrides.set("DATADOG_APPLICATION_KEY", "synthetic-app-secret");
    fixture.overrides.set("DATADOG_USER_EMAIL", "person@example.invalid");
    fixture.overrides.set("DATADOG_ONCALL_SCHEDULE_ID", "saved-schedule");
    fixture.read.mockClear();
    fixture.write.mockClear();
    fixture.sync.mockClear();
  });

  it.each([
    { datadog: null, calendar: { clientId: "synthetic-client" } },
    { datadog: { scheduleId: "" } },
  ])("rejects unavailable-provider writes without touching settings", async (body) => {
    expect((await save(body)).status).toBe(503);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.sync).not.toHaveBeenCalled();
    expect(fixture.overrides.get("DATADOG_ONCALL_SCHEDULE_ID")).toBe("saved-schedule");
    expect(fixture.overrides.get("DATADOG_API_KEY")).toBe("synthetic-api-secret");
    expect(fixture.overrides.has("GOOGLE_CLIENT_ID")).toBe(false);
  });

  it.each([
    () => { throw new Error("synthetic-api-secret"); },
    () => ({ configured: true, fields: {} }),
    () => ({ ...validStatus(), fields: { ...validStatus().fields, hasScheduleId: false } }),
  ])("rejects failed or inconsistent provider status before writing", async (setupStatus) => {
    fixture.providers.push({ id: "datadog", setupStatus });
    const response = await save({ datadog: { scheduleId: "" } });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-api-secret");
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.sync).not.toHaveBeenCalled();
    expect(fixture.overrides.get("DATADOG_ONCALL_SCHEDULE_ID")).toBe("saved-schedule");
  });

  it("keeps unrelated setup saves working without consulting Datadog", async () => {
    const setupStatus = vi.fn(() => { throw new Error("must not run"); });
    fixture.providers.push({ id: "datadog", setupStatus });
    expect((await save({ calendar: { clientId: "synthetic-client" } })).status).toBe(200);
    expect(setupStatus).not.toHaveBeenCalled();
    const values = fixture.write.mock.calls[0][0] as Map<string, string>;
    expect(values.get("GOOGLE_CLIENT_ID")).toBe("synthetic-client");
    expect(values.get("DATADOG_ONCALL_SCHEDULE_ID")).toBe("saved-schedule");
    expect(values.get("DATADOG_API_KEY")).toBe("synthetic-api-secret");
  });

  it("allows an explicit schedule clear when the provider is healthy", async () => {
    fixture.providers.push({ id: "datadog", setupStatus: async () => validStatus() });
    expect((await save({ datadog: { scheduleId: "" } })).status).toBe(200);
    const values = fixture.write.mock.calls[0][0] as Map<string, string>;
    expect(values.has("DATADOG_ONCALL_SCHEDULE_ID")).toBe(false);
    expect(values.get("DATADOG_USER_EMAIL")).toBe("person@example.invalid");
    expect(values.get("DATADOG_API_KEY")).toBe("synthetic-api-secret");
  });
});
