import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerResourceTools, resetResourceCaches } from "./resources.ts";
import { VaultStorage, markdownVaultCodec, jsonVaultCodec } from "../../../../shared/vault/index.ts";
import { textToBlocks } from "../convert.ts";

let repo: string;
let notesDir: string;
let docsDir: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-resources-"));
  notesDir = path.join(repo, "notes");
  docsDir = path.join(repo, "docs");
  fs.mkdirSync(notesDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  resetResourceCaches();
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** Stub the MCP server surface and capture registered templates + callbacks. */
function harness() {
  const resources: Record<string, { template: unknown; read: (uri: URL) => Promise<{ contents: Array<{ text?: string; mimeType?: string }> }> }> = {};
  const server = {
    registerResource(_name: string, template: unknown, _config: unknown, read: (uri: URL) => Promise<{ contents: Array<{ text?: string }> }>) {
      // Static resources register a plain URI string; templated ones a ResourceTemplate.
      const key = typeof template === "string" ? template : (template as { uriTemplate: { template: string } }).uriTemplate.template;
      resources[key] = { template, read };
    },
    registerTool() {},
    registerPrompt() {},
    server: { sendResourceUpdated: async () => {} },
  };
  const notes = new VaultStorage(notesDir, jsonVaultCodec);
  const docs = new VaultStorage(docsDir, markdownVaultCodec);
  const dashboard = {
    get: async (route: string) => {
      if (route === "/api/agent/runs") return { runs: [{ id: "run-abc123-0011aabb", providerLabel: "Claude Code", title: "Fix it" }] };
      if (route.startsWith("/api/agent/runs/run-abc123-0011aabb")) {
        return {
          run: {
            id: "run-abc123-0011aabb", provider: "claude", providerLabel: "Claude Code", title: "Fix it",
            model: null, state: "running", cwd: "/tmp/x", worktree: null, parentRunId: null,
            createdAt: 1, startedAt: null, finishedAt: null, exitCode: null, eventCount: 2,
            sessionId: "s-1", terminalSessionId: null, resultText: null, costUsd: null, turns: null, error: null,
          } as never,
          events: [
            { seq: 0, ts: 1, type: "session", sessionId: "s-1" },
            { seq: 1, ts: 2, type: "text", text: "Working on it." },
          ],
          next: 2,
          total: 2,
        };
      }
      if (route === "/api/jobs") {
        return {
          jobs: [
            {
              id: "8664b37a-9d37", name: "Wake test", cron: "19 19 * * *", enabled: true, kind: "script",
              script: "verify_sync", wake: true, nextRunAt: null, scheduleValid: true,
            },
          ],
          wake: { helper: "ready", version: "1.1.0", scheduledAt: null },
        };
      }
      if (route === "/api/jobs/log") {
        return {
          file: "/home/.local/state/devhub/scheduler.log",
          lines: ['2026-09-14T18:19:09.645Z INFO  [scheduler] running "Wake test" (8664b37a) for 19:19'],
          helper: { file: "/var/log/com.devhub.wake-helper.log", lines: ["2026-09-14T18:15:02Z started v1.1.0"] },
        };
      }
      throw new Error(`unexpected route ${route}`);
    },
  };
  registerResourceTools(server as never, {
    repoRoot: repo,
    notesDir,
    docsDir,
    tasksDir: repo,
    storage: notes,
    docsStorage: docs,
    tasksStorage: {} as never,
    diagramsStorage: {} as never,
    dashboard,
    dashboardInfo: { baseUrl: "http://x" } as never,
  } as never);
  return resources;
}

describe("notes resource", () => {
  it("serves a note as readable markdown", async () => {
    const r = harness();
    notesDir && fs.mkdirSync(path.join(notesDir, "daily"), { recursive: true });
    new VaultStorage(notesDir, jsonVaultCodec).write("daily/2026-09-14", textToBlocks("# Journal\n\nWrote resources."));
    const out = await r["devhub://notes/{+path}"].read(new URL("devhub://notes/daily/2026-09-14"));
    expect(out.contents[0].text).toContain("Wrote resources.");
    expect(out.contents[0].mimeType).toBe("text/markdown");
  });

  it("rejects traversal", async () => {
    const r = harness();
    // URL normalisation collapses ../ before the read, so this lands as a missing
    // file inside the vault — containment held either way.
    const out = await r["devhub://notes/{+path}"].read(new URL("devhub://notes/../../etc/passwd"));
    expect(out.contents[0].text).toMatch(/Note not found|Invalid note path/);
  });

  it("says so when the note is missing", async () => {
    const r = harness();
    const out = await r["devhub://notes/{+path}"].read(new URL("devhub://notes/daily/1999-01-01"));
    expect(out.contents[0].text).toContain("Note not found");
  });
});

describe("docs resource", () => {
  it("serves raw markdown", async () => {
    const r = harness();
    fs.writeFileSync(path.join(docsDir, "guide.md"), "# Guide\n\nBody text.");
    const out = await r["devhub://docs/{+path}"].read(new URL("devhub://docs/guide"));
    expect(out.contents[0].text).toContain("Body text.");
  });

  it("rejects traversal out of the docs root", async () => {
    const r = harness();
    const out = await r["devhub://docs/{+path}"].read(new URL("devhub://docs/../secrets.txt"));
    expect(out.contents[0].text).toMatch(/Doc not found|Invalid doc path/);
  });
});

describe("agent-runs events resource", () => {
  it("formats the run summary and events like agent_output", async () => {
    const r = harness();
    const out = await r["devhub://agent-runs/{runId}/events"].read(new URL("devhub://agent-runs/run-abc123-0011aabb/events"));
    const text = out.contents[0].text ?? "";
    expect(text).toContain("Claude Code");
    expect(text).toContain("session s-1");
    expect(text).toContain("Working on it.");
  });

  it("rejects malformed run ids without calling the dashboard", async () => {
    const r = harness();
    const out = await r["devhub://agent-runs/{runId}/events"].read(new URL("devhub://agent-runs/not-a-run/events"));
    expect(out.contents[0].text).toContain("Invalid run id");
  });
});

describe("scheduled jobs resources", () => {
  it("serves jobs and wake status like jobs_list", async () => {
    const r = harness();
    const out = await r["devhub://jobs"].read(new URL("devhub://jobs"));
    const text = out.contents[0].text ?? "";
    expect(text).toContain("Wake: helper 1.1.0 ready");
    expect(text).toContain("Wake test");
    expect(text).toContain("script verify_sync");
  });

  it("serves the scheduler and helper logs like jobs_log", async () => {
    const r = harness();
    const out = await r["devhub://jobs/log"].read(new URL("devhub://jobs/log"));
    const text = out.contents[0].text ?? "";
    expect(text).toContain('running "Wake test"');
    expect(text).toContain("Wake helper log (/var/log/com.devhub.wake-helper.log):");
    expect(text).toContain("started v1.1.0");
  });
});
