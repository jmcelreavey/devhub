import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { freeLoopbackPort, startSmokeServer } from "./checkout-payload-smoke.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-slim-smoke-"));
const token = randomBytes(32).toString("hex");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error("Slim smoke exceeded 30 seconds")), 30_000);
const interrupt = () => controller.abort(new Error("Slim smoke interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let server;

try {
  let port;
  do { port = await freeLoopbackPort(); } while ([1337, 1339, 1340].includes(port));
  const base = `http://127.0.0.1:${port}`;
  const bin = path.join(scratch, "bin");
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  if (fs.existsSync("/usr/bin/git")) fs.symlinkSync("/usr/bin/git", path.join(bin, "git"));
  fs.symlinkSync("/bin/sh", path.join(bin, "sh"));
  for (const dir of ["home", "config", "resources", "data", "notes", "tasks", "docs", "collections", "upstarts", "repos", "plugins"]) {
    fs.mkdirSync(path.join(scratch, dir));
  }
  const env = {
    PATH: bin,
    HOME: path.join(scratch, "home"),
    XDG_CONFIG_HOME: path.join(scratch, "config"),
    XDG_DATA_HOME: path.join(scratch, "data"),
    XDG_STATE_HOME: path.join(scratch, "data", "state"),
    NODE_ENV: "production",
    TSX_TSCONFIG_PATH: path.join(repo, "apps/ui/tsconfig.json"),
    PORT: String(port),
    DEVHUB_BIND_HOST: "127.0.0.1",
    DEVHUB_DESKTOP: "1",
    DEVHUB_CORE_SERVER: "1",
    DEVHUB_UI_DIST: path.join(repo, "apps/ui/dist"),
    DEVHUB_BOOTSTRAP_TOKEN: token,
    DEVHUB_SCHEDULER: "0",
    DEVHUB_MCP_HTTP: "0",
    DEVHUB_CONFIG_DIR: path.join(scratch, "config"),
    DEVHUB_PLUGIN_HOME: path.join(scratch, "plugins"),
    DEVHUB_PLUGIN_TARGET_HOME: path.join(scratch, "plugins"),
    DEVHUB_APP_DATA: path.join(scratch, "data"),
    DEVHUB_ENV_FILE: path.join(scratch, "config", ".env.local"),
    DEVHUB_RESOURCE_ROOT: path.join(scratch, "resources"),
    DEVHUB_SERVER_DIR: repo,
    DEVHUB_REPOS_DIR: path.join(scratch, "repos"),
    REPO_ROOT: scratch,
    NOTES_DIR: path.join(scratch, "notes"),
    TASKS_DIR: path.join(scratch, "tasks"),
    DOCS_DIR: path.join(scratch, "docs"),
    COLLECTIONS_DIR: path.join(scratch, "collections"),
    UPSTARTS_DIR: path.join(scratch, "upstarts"),
  };
  server = startSmokeServer(process.execPath, ["--import", "tsx", path.join(repo, "scripts/core-server.ts")], {
    cwd: path.join(repo, "apps/ui"), env,
  });

  const headers = { "x-devhub-token": token, "x-devhub-task-profile": "legacy" };
  const request = (url, options = {}) => fetch(base + url, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: controller.signal,
  });
  while (true) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (server.exited()) throw new Error("Slim smoke server exited before becoming ready");
    try {
      const response = await request("/api/desktop/health");
      if (response.ok) {
        const health = await response.json();
        if (health.devhub === true && health.desktop === true && health.status === "ready" && health.pid === server.pid) break;
      }
    } catch {
      if (controller.signal.aborted) throw controller.signal.reason;
    }
    await delay(100, undefined, { signal: controller.signal });
  }

  async function check(url, status, options = {}) {
    const response = await request(url, options);
    if (response.status !== status) {
      assert.equal(response.status, status, `${options.method ?? "GET"} ${url}: ${await response.text()}`);
    }
    return response;
  }
  const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const denied = await fetch(base + "/api/tasks", { ...json("POST", { text: "denied" }), signal: controller.signal });
  assert.equal(denied.status, 403, "unauthenticated mutation");

  await check("/api/tasks/profiles", 201, json("POST", { action: "create", id: "smoke" }));
  headers["x-devhub-task-profile"] = "smoke";
  const task = await (await check("/api/tasks", 201, json("POST", { text: "Smoke task" }))).json();
  assert.ok(task.id);
  const taskList = await (await check("/api/tasks", 200)).json();
  assert.ok(taskList.tasks.some((item) => item.id === task.id && item.text === "Smoke task"));
  await check("/api/tasks", 200, json("DELETE", { id: task.id }));
  const remainingTasks = await (await check("/api/tasks", 200)).json();
  assert.ok(!remainingTasks.tasks.some((item) => item.id === task.id));

  const notePath = "/api/notes/slim-smoke";
  const content = [{ id: "smoke", type: "paragraph", props: {}, content: [{ type: "text", text: "Smoke note", styles: {} }], children: [] }];
  await check(notePath, 201, json("POST", { content }));
  const note = await (await check(notePath, 200)).json();
  assert.deepEqual(note.content, content);
  await check(notePath, 409, json("PUT", { content: [], expectedModified: null }));
  const afterStale = await (await check(notePath, 200)).json();
  assert.deepEqual(afterStale.content, note.content);
  assert.equal(afterStale.modified, note.modified);
  const tree = await (await check("/api/tree", 200)).json();
  assert.ok(JSON.stringify(tree).includes("slim-smoke"));
  await check(notePath, 200, { method: "DELETE" });
  await check(notePath, 404);
  await check("/api/slim-smoke-missing", 404);
  for (const route of ["/", "/notes/slim-smoke/deep"]) {
    const response = await new Promise((resolve, reject) => {
      const req = http.get(base + route, {
        headers: { ...headers, accept: "text/html", "sec-fetch-mode": "navigate" },
        signal: controller.signal,
      }, resolve);
      req.on("error", reject);
    });
    assert.equal(response.statusCode, 200, `GET ${route}`);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    assert.match(Buffer.concat(chunks).toString(), /<html[\s>]/i);
  }
  console.log("Slim HTTP smoke passed.");
} catch (error) {
  console.error("Slim HTTP smoke failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  try { await server?.stop(); }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
