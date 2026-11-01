import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const root = mkdtempSync(path.join(tmpdir(), "jira-tickets-"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

it("distinguishes missing Jira setup from an upstream failure", async () => {
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, "config", "settings"));
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_APP_DATA", root);
  vi.stubEnv("JIRA_DOMAIN", "");
  vi.stubEnv("JIRA_EMAIL", "");
  vi.stubEnv("JIRA_API_TOKEN", "");
  const request = () => new Request("http://localhost/api/jira/tickets");

  const unconfigured = await GET(request());
  expect(unconfigured.status).toBe(200);
  expect(await unconfigured.json()).toEqual({ configured: false, tickets: [] });

  vi.stubEnv("JIRA_DOMAIN", "jira.invalid");
  vi.stubEnv("JIRA_EMAIL", "fixture@example.invalid");
  vi.stubEnv("JIRA_API_TOKEN", "fixture");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

  const unavailable = await GET(request());
  expect(unavailable.status).toBe(502);
  expect(await unavailable.json()).toEqual({ configured: true, error: "Couldn't load Jira tickets. Check the connection and retry." });

  vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
  const rejected = await GET(request());
  expect(rejected.status).toBe(502);
  expect(await rejected.json()).toEqual({ configured: true, error: "Couldn't load Jira tickets. Check the connection and retry." });

  vi.mocked(fetch).mockResolvedValue(new Response("Authentication failed: private upstream diagnostic", { status: 500 }));
  const upstreamDetails = await GET(request());
  expect(upstreamDetails.status).toBe(502);
  expect(await upstreamDetails.json()).toEqual({ configured: true, error: "Couldn't load Jira tickets. Check the connection and retry." });
});
