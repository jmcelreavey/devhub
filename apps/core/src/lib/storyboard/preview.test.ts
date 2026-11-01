import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ensurePreview, isExpoProject, isManagedPreviewForTask, leaseManagedPreviewForTask, managedPreviewForTask, stopPreview } from "./preview";

const previousUpstartsDir = process.env.UPSTARTS_DIR;
const taskId = "isolated-preview-test";
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "devhub-preview-"));
  process.env.UPSTARTS_DIR = path.join(root, "upstarts");
  mkdirSync(path.join(root, "upstarts", "fixture"), { recursive: true });
});

afterEach(() => {
  stopPreview(taskId);
  if (previousUpstartsDir === undefined) delete process.env.UPSTARTS_DIR;
  else process.env.UPSTARTS_DIR = previousUpstartsDir;
  rmSync(root, { recursive: true, force: true });
});

function configure(config: object): void {
  writeFileSync(path.join(root, "upstarts", "fixture", "preview.json"), JSON.stringify({ autoStart: true, path: "/", ...config }));
}

test("detects Expo from dependencies or app.json without accepting malformed files", () => {
  expect(isExpoProject(root)).toBe(false);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { expo: "~54" } }));
  expect(isExpoProject(root)).toBe(true);
  writeFileSync(path.join(root, "package.json"), "{");
  writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "fixture" } }));
  expect(isExpoProject(root)).toBe(true);
  writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: null }));
  expect(isExpoProject(root)).toBe(false);
});

test("detected Expo still requires explicit trust before launching", async () => {
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { expo: "~54" } }));
  configure({});
  expect(await ensurePreview({ taskId, repoName: "fixture", cwd: root })).toMatchObject({ state: "none", reason: expect.stringContaining("trustCommand") });
});

test.skipIf(process.platform === "win32")("launches detected Expo on the owned free port", async () => {
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const argsFile = path.join(root, "args");
  const server = path.join(root, "expo.cjs");
  writeFileSync(server, `const args = process.argv.slice(2); require('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args)); require('node:http').createServer((_req, res) => res.end('Expo fixture')).listen(Number(args.at(-1)), '127.0.0.1');`);
  const npx = path.join(bin, "npx");
  writeFileSync(npx, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(server)} "$@"\n`);
  chmodSync(npx, 0o755);
  writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "fixture" } }));
  configure({ autoStart: true, trustCommand: true });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  try {
    let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
    const deadline = Date.now() + 20_000;
    while (preview.state === "starting" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
    }
    expect(preview.state).toBe("started");
    if (!preview.url) throw new Error(preview.reason);
    expect(await (await fetch(preview.url)).text()).toBe("Expo fixture");
    const args: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
    expect(args.slice(0, -1)).toEqual(["--no-install", "expo", "start", "--web", "--port"]);
    expect(Number(args.at(-1))).toBeGreaterThan(0);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}, 30_000);

test("command previews cannot grant automatic QA an unowned port", async () => {
  configure({ kind: "dev", command: "npm run dev", port: 49152 });
  const preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  expect(preview).toMatchObject({ state: "none", url: null, reason: expect.stringContaining("cannot prove connection ownership") });
  expect(managedPreviewForTask(taskId)).toBeNull();
});

test("requires explicit trust before running a preview command", async () => {
  configure({ kind: "dev", command: "node server.js {port}" });
  const preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  expect(preview).toMatchObject({ state: "none", reason: expect.stringContaining("trustCommand") });
  expect(managedPreviewForTask(taskId)).toBeNull();
});

test.skipIf(process.platform === "win32")("runs a task-owned dynamic preview without trusting a pre-existing port", async () => {
  const server = path.join(root, "server.cjs");
  writeFileSync(server, 'require("node:http").createServer((_request, response) => response.end("Task-owned dynamic page")).listen(Number(process.argv[2]), "127.0.0.1")');
  configure({ kind: "dev", trustCommand: true, command: `${JSON.stringify(process.execPath)} ${JSON.stringify(server)} {port}` });

  let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  const deadline = Date.now() + 20_000;
  while (preview.state === "starting" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  }
  expect(preview.state).toBe("started");
  if (!preview.url) throw new Error("Expected an owned dynamic preview");
  expect(await (await fetch(preview.url)).text()).toContain("Task-owned dynamic page");
  expect((await fetch(preview.url, { method: "POST" })).status).toBe(405);
  expect(isManagedPreviewForTask(taskId, preview.url)).toBe(true);
}, 30_000);

test.skipIf(process.platform === "win32")("waits for HTTP 200 from the owned preview", async () => {
  const flag = path.join(root, "ready");
  const seen = path.join(root, "seen");
  const server = path.join(root, "not-ready.cjs");
  writeFileSync(server, `const fs = require('node:fs'); require('node:http').createServer((_req, res) => { fs.writeFileSync(${JSON.stringify(seen)}, 'seen'); res.statusCode = fs.existsSync(${JSON.stringify(flag)}) ? 200 : 503; res.end('preview'); }).listen(Number(process.argv[2]), '127.0.0.1');`);
  configure({ kind: "dev", trustCommand: true, command: `${JSON.stringify(process.execPath)} ${JSON.stringify(server)} {port}` });
  let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  const deadline = Date.now() + 20_000;
  while (preview.state === "starting" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
    if (existsSync(seen)) break;
  }
  expect(existsSync(seen)).toBe(true);
  expect(preview.state).toBe("starting");
  writeFileSync(flag, "ready");
  while (preview.state === "starting" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  }
  expect(preview.state).toBe("started");
}, 30_000);

test.skipIf(process.platform === "win32")("refuses a foreign listener before QA can start", async () => {
  const portFile = path.join(root, "port");
  const server = path.join(root, "waiting.cjs");
  writeFileSync(server, `require('node:fs').writeFileSync(${JSON.stringify(portFile)}, process.argv[2]); setInterval(() => {}, 1000);`);
  configure({ kind: "dev", trustCommand: true, command: `${JSON.stringify(process.execPath)} ${JSON.stringify(server)} {port}` });
  let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  const deadline = Date.now() + 20_000;
  while (!existsSync(portFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  expect(existsSync(portFile)).toBe(true);
  let requests = 0;
  const foreign = http.createServer((_req, res) => { requests++; res.end("foreign"); });
  await new Promise<void>((resolve, reject) => { foreign.once("error", reject); foreign.listen(Number(readFileSync(portFile, "utf8")), "127.0.0.1", resolve); });
  try {
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
    expect(preview).toMatchObject({ state: "none", reason: expect.stringContaining("another process") });
    expect(managedPreviewForTask(taskId)).toBeNull();
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>(resolve => foreign.close(() => resolve()));
  }
}, 30_000);

test.skipIf(process.platform === "win32")("waits for an owned preview to accept a connection while it is busy", async () => {
  const server = path.join(root, "busy-server.cjs");
  const busyFile = path.join(root, "busy");
  writeFileSync(server, [
    'const http = require("node:http");',
    'const fs = require("node:fs");',
    `const server = http.createServer((request, response) => { if (request.url === "/busy") { response.end("busy"); setImmediate(() => { fs.writeFileSync(${JSON.stringify(busyFile)}, "busy"); const until = Date.now() + 1200; while (Date.now() < until) {} }); return; } response.end("owned"); });`,
    'server.listen(Number(process.argv[2]), "127.0.0.1");',
  ].join("\n"));
  configure({ kind: "dev", trustCommand: true, command: `${JSON.stringify(process.execPath)} ${JSON.stringify(server)} {port}` });

  let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  const deadline = Date.now() + 20_000;
  while (preview.state === "starting" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  }
  if (preview.state !== "started") throw new Error(`Owned preview did not start: ${preview.reason}`);
  expect((await fetch(new URL("/busy", preview.url))).status).toBe(200);
  while (!existsSync(busyFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(existsSync(busyFile)).toBe(true);
  expect((await fetch(preview.url)).status).toBe(200);
}, 30_000);

test.skipIf(process.platform === "win32")("never sends a request to a process that takes over the backend port", async () => {
  const server = path.join(root, "server.cjs");
  const portFile = path.join(root, "backend-port");
  const releasedFile = path.join(root, "released");
  writeFileSync(server, [
    'const http = require("node:http");',
    'const fs = require("node:fs");',
    `const server = http.createServer((request, response) => { response.end("owned"); if (request.url === "/release") server.close(() => fs.writeFileSync(${JSON.stringify(releasedFile)}, "released")); });`,
    `server.listen(Number(process.argv[2]), "127.0.0.1", () => fs.writeFileSync(${JSON.stringify(portFile)}, process.argv[2]));`,
    'setInterval(() => {}, 1000);',
  ].join("\n"));
  configure({ kind: "dev", trustCommand: true, command: `${JSON.stringify(process.execPath)} ${JSON.stringify(server)} {port}` });
  let preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  const deadline = Date.now() + 20_000;
  while (preview.state === "starting" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  }
  if (preview.state !== "started") throw new Error(`Owned preview did not start: ${preview.reason}`);
  expect((await fetch(new URL("/release", preview.url))).status).toBe(200);
  while (!existsSync(releasedFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  expect(existsSync(releasedFile)).toBe(true);
  const port = Number(readFileSync(portFile, "utf8"));
  let requests = 0;
  const replacement = http.createServer((_request, response) => { requests++; response.end("wrong process"); });
  await new Promise<void>((resolve, reject) => { replacement.once("error", reject); replacement.listen(port, "127.0.0.1", resolve); });
  try {
    expect((await fetch(preview.url)).status).toBe(502);
    expect(requests).toBe(0);
    expect(managedPreviewForTask(taskId)).toBeNull();
    expect(await ensurePreview({ taskId, repoName: "fixture", cwd: root })).toMatchObject({ state: "none", reason: expect.stringContaining("another process") });
  } finally {
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
  }
}, 30_000);

test("static mode will not expose the entire checkout", async () => {
  configure({ kind: "static", directory: "." });
  const preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  expect(preview).toMatchObject({ state: "none", url: null });
});

test("QA reaches only the held static listener, which denies requests after revocation", async () => {
  const site = path.join(root, "site");
  mkdirSync(site);
  writeFileSync(path.join(site, "index.html"), "<h1>Fixture preview</h1>");
  writeFileSync(path.join(root, "outside.txt"), "private fixture");
  if (process.platform !== "win32") symlinkSync(path.join(root, "outside.txt"), path.join(site, "outside.txt"));
  configure({ kind: "static", directory: "site" });

  const preview = await ensurePreview({ taskId, repoName: "fixture", cwd: root });
  expect(preview.state).toBe("started");
  if (!preview.url) throw new Error("Expected an owned static preview");
  expect(new URL(preview.url).hostname).toBe("127.0.0.1");
  expect(managedPreviewForTask(taskId)).toBe(preview.url);
  expect(isManagedPreviewForTask(taskId, preview.url)).toBe(true);
  const response = await fetch(preview.url);
  expect(await response.text()).toContain("Fixture preview");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
  if (process.platform !== "win32") expect((await fetch(new URL("/outside.txt", preview.url))).status).toBe(403);

  const release = leaseManagedPreviewForTask(taskId, preview.url);
  expect(release).not.toBeNull();
  try {
    stopPreview(taskId);
    expect(managedPreviewForTask(taskId)).toBeNull();
    expect((await fetch(preview.url)).status).toBe(410);
  } finally {
    release?.();
  }
});
