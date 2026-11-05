import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadOpenCodeGoUsage } from "./opencode-go";

let dataDir: string | undefined;
beforeEach(() => vi.stubEnv("OPENCODE_GO_API_KEY", "fixture-key"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

it("shows the three Go allowance windows from the usage API", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    usage: {
      rolling: { status: "ok", percent: 12, resetsAt: "2026-11-04T17:00:00Z" },
      weekly: { status: "ok", percent: 34, resetsAt: "2026-11-09T00:00:00Z" },
      monthly: { status: "ok", percent: 56, resetsAt: "2026-12-01T00:00:00Z" },
    },
  })));

  const usage = await loadOpenCodeGoUsage();
  expect(usage?.meters.map(({ label, percent }) => ({ label, percent }))).toEqual([
    { label: "5-hour", percent: 12 },
    { label: "Weekly", percent: 34 },
    { label: "Monthly", percent: 56 },
  ]);
});

it("uses the active OpenCode 2 credential before a stale auth.json key", async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-go-"));
  const openCodeDir = path.join(dataDir, "opencode");
  fs.mkdirSync(openCodeDir);
  const database = new DatabaseSync(path.join(openCodeDir, "opencode.db"));
  database.exec("CREATE TABLE credential (integration_id TEXT, active INTEGER, time_updated INTEGER, value TEXT)");
  database.prepare("INSERT INTO credential VALUES (?, ?, ?, ?)").run("opencode-go", 1, 1, JSON.stringify({ type: "key", key: "active-key" }));
  database.close();
  fs.writeFileSync(path.join(openCodeDir, "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: "stale-key" } }));
  vi.stubEnv("XDG_DATA_HOME", dataDir);
  vi.stubEnv("OPENCODE_GO_API_KEY", "");
  vi.stubEnv("OPENCODE_API_KEY", "");
  const fetch = vi.fn().mockResolvedValue(Response.json({ usage: {
    rolling: { percent: 0, resetsAt: "2026-11-04T17:00:00Z" },
    weekly: { percent: 0, resetsAt: "2026-11-09T00:00:00Z" },
    monthly: { percent: 0, resetsAt: "2026-12-01T00:00:00Z" },
  } }));
  vi.stubGlobal("fetch", fetch);

  await loadOpenCodeGoUsage();
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer active-key");
});

it("reports an expired key without exposing the response body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fixture-key: private response", { status: 401 })));
  await expect(loadOpenCodeGoUsage()).rejects.toMatchObject({
    message: "OpenCode Go rejected the saved key.",
    reason: "Reconnect OpenCode Console or Go in OpenCode, then retry.",
  });
});

it("rejects incomplete usage instead of showing a partial allowance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ usage: { rolling: { percent: 0, resetsAt: "2026-11-04T17:00:00Z" } } })));
  await expect(loadOpenCodeGoUsage()).rejects.toThrow("Couldn't read OpenCode Go usage.");
});
