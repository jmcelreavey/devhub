import fs from "node:fs/promises";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { GET } from "../../http/routes/events/route";
import { taskEventStream } from "./task-stream";
import { emitCoreEvent, subscribeCoreEvents } from "./core-events";
import { isMining, mineRepoConventions } from "../../lib/conventions/miner";
import { beginExternalCall, endExternalCall, listInFlightCalls } from "../../lib/exec-registry";
import { createTerminalProposal, resolveTerminalProposal } from "../../lib/terminal/proposals";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "../storage/sqlite";

afterEach(() => vi.unstubAllEnvs());

it("invalidates in-memory core state without leaking contents", async () => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    const reader = taskEventStream([], abort.signal).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    emitCoreEvent("media");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"media"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
});

it("keeps core events available when an optional watcher cannot start", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-optional-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await fs.writeFile(path.join(root, "not-a-directory"), "invalid plugin path");
    const reader = taskEventStream([
      { path: path.join(root, "not-a-directory"), domain: "plugins", optional: true },
      { path: root, domain: "tasks" },
    ], abort.signal).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('event: ready\ndata: {"degradedDomains":["plugins"]}');
    expect(errorLog).toHaveBeenCalled();
    await fs.writeFile(path.join(root, "task.json"), "private");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"tasks"}\n\n');
  } finally {
    errorLog.mockRestore();
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects if a scoped root changed before readiness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-scope-"));
  const abort = new AbortController();
  let current = true;
  try {
    const reader = taskEventStream([{ path: root, domain: "git", validate: () => current }], abort.signal).getReader();
    current = false;
    expect((await reader.read()).done).toBe(true);
  } finally {
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.each([false, true])("watches local plugin sources and reconnects when the registry changes (invalid entry: %s)", async (invalidEntry) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-local-plugin-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "local-plugin"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    const registry = path.join(root, "config", "plugins.json");
    await fs.writeFile(path.join(root, "local-plugin", "devhub-plugin.json"), JSON.stringify({ name: "local-plugin", version: "1", devhubApi: "1", contributes: {} }));
    await fs.writeFile(registry, JSON.stringify({ plugins: [...(invalidEntry ? [{}] : []), { path: path.join(root, "local-plugin") }] }));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_DESKTOP", "0");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?plugins=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "local-plugin", "private.txt"), "private contents");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"plugins"}\n\n');
    await fs.writeFile(registry, JSON.stringify({ plugins: [] }));
    let closed = false;
    while (!closed) closed = (await reader.read()).done;
    expect(closed).toBe(true);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects when an invalid plugin manifest becomes valid", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-invalid-plugin-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "local-plugin"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    const manifest = path.join(root, "local-plugin", "devhub-plugin.json");
    await fs.writeFile(manifest, "invalid");
    await fs.writeFile(path.join(root, "config", "plugins.json"), JSON.stringify({ plugins: [{ path: path.join(root, "local-plugin") }] }));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_DESKTOP", "0");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const request = () => GET(new Request("http://localhost:1437/api/events?plugins=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    })).body!.getReader();
    const decoder = new TextDecoder();
    const first = request();
    expect(decoder.decode((await first.read()).value)).toContain("event: ready");
    await fs.writeFile(manifest, JSON.stringify({ name: "local-plugin", version: "1", devhubApi: "1", contributes: {} }));
    let closed = false;
    while (!closed) closed = (await first.read()).done;
    const second = request();
    expect(decoder.decode((await second.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "local-plugin", "private.txt"), "private contents");
    expect(decoder.decode((await second.read()).value)).toBe('event: invalidate\ndata: {"domain":"plugins"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects to the newly linked checkout when its path changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-linked-checkout-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "app", "first/.git", "second/.git"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    const link = path.join(root, "app", "content-repo-path.txt");
    await fs.writeFile(link, path.join(root, "first"));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", path.join(root, "app"));
    vi.stubEnv("REPO_ROOT", "");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const request = () => GET(new Request("http://localhost:1437/api/events?checkout=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    })).body!.getReader();
    const decoder = new TextDecoder();
    const first = request();
    expect(decoder.decode((await first.read()).value)).toContain("event: ready");
    await fs.writeFile(link, path.join(root, "second"));
    let closed = false;
    while (!closed) closed = (await first.read()).done;
    const second = request();
    expect(decoder.decode((await second.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "second", "private.txt"), "private contents");
    expect(decoder.decode((await second.read()).value)).toBe('event: invalidate\ndata: {"domain":"git"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.each([
  ["reps", "reps/today.json"],
  ["script-history", ".local/state/devhub/runs.jsonl"],
  ["skill-proposals", ".local/state/devhub/skill-proposals/one.json"],
  ["skill-proposals", "skills/shared/example/SKILL.md"],
  ["cli-updates", ".local/state/devhub/agent-cli-updates.json"],
  ["cli-updates", ".local/state/agent-cli-updates.lock/owner.json"],
  ["projects", ".config/devhub/projects.json"],
  ["shares", ".local/state/devhub/shares.json"],
] as const)("invalidates external %s record changes", async (domain, relative) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-record-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    const file = path.join(root, relative);
    await Promise.all(["notes", "tasks", "collections", "runs", "config", path.dirname(relative)].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    await fs.writeFile(file, "initial");
    vi.stubEnv("HOME", root);
    vi.stubEnv("REPO_ROOT", root);
    vi.stubEnv("REPS_DIR", path.join(root, "reps"));
    vi.stubEnv("DEVHUB_DESKTOP", "0");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_PROJECTS_FILE", path.join(root, ".config/devhub/projects.json"));
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?records=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.appendFile(file, "private contents");
    expect(decoder.decode((await reader.read()).value)).toBe(`event: invalidate\ndata: {"domain":"${domain}"}\n\n`);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects when a shares registry is atomically replaced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-share-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", ".local/state/devhub"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    const file = path.join(root, ".local/state/devhub/shares.json");
    await fs.writeFile(file, "{}");
    vi.stubEnv("HOME", root);
    vi.stubEnv("REPO_ROOT", root);
    vi.stubEnv("DEVHUB_DESKTOP", "0");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?records=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(`${file}.tmp`, "private contents");
    await fs.rename(`${file}.tmp`, file);
    let closed = false;
    while (!closed) closed = (await reader.read()).done;
    expect(closed).toBe(true);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("invalidates recall when documentation or repository membership changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-recall-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "docs", "repos"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    vi.stubEnv("HOME", root);
    vi.stubEnv("REPO_ROOT", root);
    vi.stubEnv("DEVHUB_DESKTOP", "0");
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("DOCS_DIR", path.join(root, "docs"));
    vi.stubEnv("DEVHUB_REPOS_DIR", path.join(root, "repos"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?recall=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "docs", "private.md"), "private contents");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"recall"}\n\n');
    await fs.mkdir(path.join(root, "repos", "new-repo"));
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"recall"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("watches the content checkout separately and reconnects when its git directory changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-content-git-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "app", "content/.git", "content/notes"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", path.join(root, "app"));
    vi.stubEnv("DEVHUB_CONTENT_ROOT", path.join(root, "content"));
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?content=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "content/notes/private.json"), "private contents");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"git"}\n\n');
    await fs.writeFile(path.join(root, "content/.git/index"), "index contents");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"git"}\n\n');
    await fs.rename(path.join(root, "content/.git"), path.join(root, "content/previous-git"));
    let closed = false;
    while (!closed) closed = (await reader.read()).done;
    expect(closed).toBe(true);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("invalidates convention mining when work starts and finishes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-mining-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    vi.stubEnv("NOTES_DIR", root);
    const reader = taskEventStream([], abort.signal).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    const mining = mineRepoConventions("example/stream", {
      trigger: "review",
      deps: { fetchFeedback: async () => { await gate; return []; }, fetchGuidance: async () => [] },
    });
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"conventions"}\n\n');
    expect(isMining("example/stream")).toBe(true);
    release();
    await mining;
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"conventions"}\n\n');
    expect(isMining("example/stream")).toBe(false);
  } finally {
    release();
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("invalidates execution state on start and finish", async () => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  let id: number | undefined;
  try {
    const reader = taskEventStream([], abort.signal).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    id = beginExternalCall({ file: "probe", args: ["private"], timeoutMs: 1000 });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"exec"}\n\n');
    expect(listInFlightCalls().some((call) => call.id === id)).toBe(true);
    endExternalCall(id, { ok: true, timedOut: false });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"exec"}\n\n');
    expect(listInFlightCalls().some((call) => call.id === id)).toBe(false);
  } finally {
    if (id !== undefined) endExternalCall(id, { ok: false, timedOut: false });
    clearTimeout(timeout);
    abort.abort();
  }
});

it("only broadcasts short execution calls when they time out", () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const unsubscribe = subscribeCoreEvents((domain) => events.push(domain));
  try {
    const shortCall = beginExternalCall({ file: "probe", args: [], timeoutMs: 1000 });
    endExternalCall(shortCall, { ok: true, timedOut: false });
    vi.advanceTimersByTime(250);
    expect(events).toEqual([]);

    const longCall = beginExternalCall({ file: "probe", args: [], timeoutMs: 1000 });
    vi.advanceTimersByTime(250);
    expect(events).toEqual(["exec"]);
    endExternalCall(longCall, { ok: true, timedOut: false });
    expect(events).toEqual(["exec", "exec"]);

    const timedOutCall = beginExternalCall({ file: "probe", args: [], timeoutMs: 1 });
    endExternalCall(timedOutCall, { ok: false, timedOut: true });
    expect(events).toEqual(["exec", "exec", "exec"]);
  } finally {
    unsubscribe();
    vi.useRealTimers();
  }
});

it("invalidates terminal proposals without exposing commands", async () => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    const reader = taskEventStream([], abort.signal).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    const proposal = createTerminalProposal({ command: "echo private", source: "api" });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"terminal"}\n\n');
    resolveTerminalProposal(proposal.id, "deny");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"terminal"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
});

it("rejects unauthenticated and cross-origin streams before watching storage", () => {
  vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  for (const headers of [new Headers({ host: "localhost:1437" }), new Headers({ host: "localhost:1437", origin: "https://other.example" })]) {
    const response = GET(new Request("http://localhost:1437/api/events", { headers }));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

it("invalidates desktop log appends without exposing log contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-log-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "logs"].map((name) => fs.mkdir(path.join(root, name))));
    await fs.writeFile(path.join(root, "logs", "shell.log"), "initial\n");
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_APP_DATA", root);
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.appendFile(path.join(root, "logs", "shell.log"), "private log content\n");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"logs"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.each(["operations/op.json", "repos/plugin/devhub-plugin.json", "receipts/plugin.json"])("invalidates plugin changes at %s", async (file) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-plugin-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config/plugins/operations", "config/plugins/repos/plugin", "config/plugins/receipts"].map((name) => fs.mkdir(path.join(root, name), { recursive: true })));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_APP_DATA", root);
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events?plugins=1", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(root, "config/plugins", file), "private plugin contents");
    const domain = file.startsWith("operations/") ? "plugin-operations" : "plugins";
    expect(decoder.decode((await reader.read()).value)).toBe(`event: invalidate\ndata: {"domain":"${domain}"}\n\n`);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.each(["source", "metadata"] as const)("invalidates external %s changes in a scoped repository", async (kind) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-git-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config", "repos/alpha/.git", "repos/alpha/src"].map((name) => fs.mkdir(path.join(root, name), { recursive: true })));
    await fs.writeFile(path.join(root, "repos/alpha/.git/HEAD"), "ref: refs/heads/main\n");
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_APP_DATA", root);
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_REPOS_DIR", path.join(root, "repos"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const headers = { "x-devhub-secret": "stream-test-secret" };
    expect(GET(new Request("http://localhost:1437/api/events?repo=..%2Foutside", { headers })).status).toBe(400);
    const response = GET(new Request("http://localhost:1437/api/events?repo=alpha", { headers, signal: abort.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    const file = kind === "source" ? "repos/alpha/src/private.txt" : "repos/alpha/.git/HEAD";
    await fs.writeFile(path.join(root, file), "private contents");
    expect(decoder.decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"git"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.each([
  ["tasks", ["tasks", "profile", "items"]],
  ["notes", ["notes", ".config"]],
  ["notes", ["notes", ".cache", "repo-learn"]],
  ["rebuild", ["config", "rebuild", "service", "1457"]],
  ["collections", ["collections"]],
] as const)("authenticates a stream and invalidates atomic %s writes without exposing storage contents", async (domain, segments) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const abort = new AbortController();
  onTestFinished(() => abort.abort());
  try {
    await fs.mkdir(path.join(root, "notes", ".config"), { recursive: true });
    await fs.mkdir(path.join(root, "notes", ".cache", "repo-learn"), { recursive: true });
    await fs.mkdir(path.join(root, "config", "rebuild", "service", "1457"), { recursive: true });
    await fs.mkdir(path.join(root, "tasks", "profile", "items"), { recursive: true });
    await fs.mkdir(path.join(root, "collections"));
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("HOME", root);
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    const temporary = path.join(root, ...segments, "private.tmp");
    await fs.writeFile(temporary, JSON.stringify({ text: "private contents" }));
    await fs.rename(temporary, temporary.replace(".tmp", ".json"));
    expect(decoder.decode((await reader.read()).value)).toBe(`event: invalidate\ndata: {"domain":"${domain}"}\n\n`);
    abort.abort();
    // A slow run can queue the 15s heartbeat before the abort lands.
    let rest = await reader.read();
    while (!rest.done) {
      expect(decoder.decode(rest.value)).toBe(": heartbeat\n\n");
      rest = await reader.read();
    }
  } finally {
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("invalidates a per-machine profile change", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-profile-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await Promise.all(["notes", "tasks", "collections", "runs", "config"].map((name) => fs.mkdir(path.join(root, name))));
    const profile = path.join(root, "config", "profile.json");
    await fs.writeFile(profile, JSON.stringify({ active: "work" }));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
    vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
    vi.stubEnv("DEVHUB_STORAGE_SQLITE", "0");
    vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
    const response = GET(new Request("http://localhost:1437/api/events", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    await fs.writeFile(profile, JSON.stringify({ active: "home" }));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: invalidate\ndata: {"domain":"tasks"}\n\n');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("invalidates SQLite agent run changes without exposing database contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-sqlite-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  vi.stubEnv("HOME", root);
  vi.stubEnv("DEVHUB_DESKTOP", "");
  vi.stubEnv("DEVHUB_STATE_PROFILE", "");
  vi.stubEnv("DEVHUB_STORAGE_SQLITE", "1");
  vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("COLLECTIONS_DIR", path.join(root, "collections"));
  vi.stubEnv("DEVHUB_API_SECRET", "stream-test-secret");
  const database = sqliteDatabasePath();
  try {
    await Promise.all(["notes", "tasks", "collections", "runs"].map((name) => fs.mkdir(path.join(root, name), { recursive: true })));
    const connection = openSqliteDatabase(database);
    const response = GET(new Request("http://localhost:1437/api/events", {
      headers: { "x-devhub-secret": "stream-test-secret" }, signal: abort.signal,
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    connection.exec("CREATE TABLE event_probe (value TEXT)");
    connection.prepare("INSERT INTO event_probe (value) VALUES (?)").run("private run contents");
    expect(decoder.decode((await reader.read()).value)).toBe(`event: invalidate\ndata: {"domain":"runs"}\n\n`);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    closeSqliteDatabase(database);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects when watched SQLite files appear or are replaced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-sqlite-files-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  const database = path.join(root, "devhub.db");
  const wal = `${database}-wal`;
  const roots = [{ path: root, domain: "runs" as const, files: ["devhub.db", "devhub.db-wal"] }];
  try {
    await fs.writeFile(database, "database");
    const first = taskEventStream(roots, abort.signal).getReader();
    expect(new TextDecoder().decode((await first.read()).value)).toContain("event: ready");
    await fs.writeFile(wal, "new wal");
    expect((await first.read()).done).toBe(true);
    const second = taskEventStream(roots, abort.signal).getReader();
    expect(new TextDecoder().decode((await second.read()).value)).toContain("event: ready");
    await fs.appendFile(wal, "changed");
    expect(new TextDecoder().decode((await second.read()).value)).toContain("runs");
    await fs.writeFile(`${wal}.tmp`, "replacement");
    await fs.rename(`${wal}.tmp`, wal);
    expect((await second.read()).done).toBe(true);
    const third = taskEventStream(roots, abort.signal).getReader();
    expect(new TextDecoder().decode((await third.read()).value)).toContain("event: ready");
    await fs.appendFile(wal, "changed again");
    expect(new TextDecoder().decode((await third.read()).value)).toContain("runs");
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("does not announce readiness when a storage root cannot be watched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  try {
    const file = path.join(root, "not-a-directory");
    await fs.writeFile(file, "file");
    const stream = taskEventStream([{ path: file, domain: "tasks" }], new AbortController().signal);
    expect((await stream.getReader().read()).done).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("catches up when a missing storage root is created", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const target = path.join(root, "missing", "collections");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    const first = taskEventStream([{ path: target, domain: "collections" }], abort.signal).getReader();
    expect(new TextDecoder().decode((await first.read()).value)).toContain("event: ready");
    await fs.mkdir(target, { recursive: true });
    expect((await first.read()).done).toBe(true);
    const second = taskEventStream([{ path: target, domain: "collections" }], abort.signal).getReader();
    expect(new TextDecoder().decode((await second.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(target, "collection.json"), "updated");
    expect(new TextDecoder().decode((await second.read()).value)).toContain("collections");
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("reconnects after the storage root is replaced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const target = path.join(root, "collections");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    await fs.mkdir(target);
    const first = taskEventStream([{ path: target, domain: "collections" }], abort.signal).getReader();
    expect(new TextDecoder().decode((await first.read()).value)).toContain("event: ready");
    await fs.rename(target, path.join(root, "old"));
    await fs.mkdir(target);
    expect((await first.read()).done).toBe(true);
    const second = taskEventStream([{ path: target, domain: "collections" }], abort.signal).getReader();
    expect(new TextDecoder().decode((await second.read()).value)).toContain("event: ready");
    await fs.writeFile(path.join(target, "collection.json"), "updated");
    expect(new TextDecoder().decode((await second.read()).value)).toContain("collections");
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("catches up on writes made while watchers are starting", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const abort = new AbortController();
  try {
    const reader = taskEventStream([{ path: root, domain: "tasks" }], abort.signal).getReader();
    const file = path.join(root, "task.json");
    await fs.writeFile(file, "during startup");
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    expect(await fs.readFile(file, "utf8")).toBe("during startup");
    await fs.writeFile(file, "after ready");
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: invalidate");
  } finally {
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("invalidates directory replacements even when no JSON filename is reported", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    await fs.mkdir(path.join(root, "profile"));
    const reader = taskEventStream([{ path: root, domain: "tasks" }], abort.signal).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    await fs.rename(path.join(root, "profile"), path.join(root, "replacement"));
    expect(decoder.decode((await reader.read()).value)).toContain("event: invalidate");
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== "linux")("does not register watches inside ignored subtrees", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-stream-"));
  const abort = new AbortController();
  const countWatches = () => {
    let total = 0;
    for (const fd of readdirSync("/proc/self/fd")) {
      try {
        if (readlinkSync(`/proc/self/fd/${fd}`) !== "anon_inode:inotify") continue;
        const info = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
        total += info.split("\n").filter((line) => line.startsWith("inotify")).length;
      } catch {
        // fd closed while iterating
      }
    }
    return total;
  };
  try {
    await fs.mkdir(path.join(root, "src"));
    for (let index = 0; index < 100; index += 1) {
      await fs.mkdir(path.join(root, "node_modules", `package-${index}`, "nested"), { recursive: true });
    }
    const baseline = countWatches();
    const reader = taskEventStream([{
      path: root,
      domain: "git",
      ignore: (relative) => relative.split(path.sep).includes("node_modules"),
    }], abort.signal).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    expect(countWatches() - baseline).toBeLessThan(20);
    await fs.writeFile(path.join(root, "src", "file.ts"), "changed");
    expect(decoder.decode((await reader.read()).value)).toContain("event: invalidate");
  } finally {
    abort.abort();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15_000);
