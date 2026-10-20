import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePreview, listPreviews, previewCommand, PreviewConfigSchema, readPreviewConfig, stopPreview, type PreviewDeps } from "./preview";

let root: string;
let checkout: string;
const ORIGINAL = process.env.UPSTARTS_DIR;

function fakeChild(pid = 4242): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  Object.assign(child, { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  return child;
}

function writeConfig(repo: string, config: unknown): void {
  fs.mkdirSync(path.join(root, repo), { recursive: true });
  fs.writeFileSync(path.join(root, repo, "preview.json"), typeof config === "string" ? config : JSON.stringify(config));
}

function fakeDeps(patch: Partial<PreviewDeps> = {}): PreviewDeps & { up: { value: boolean }; clock: { value: number }; children: ChildProcess[] } {
  const up = { value: false };
  const clock = { value: 1_000 };
  const children: ChildProcess[] = [];
  return {
    up,
    clock,
    children,
    spawn: vi.fn(() => { const child = fakeChild(4242 + children.length); children.push(child); return child; }),
    freePort: async () => 4100,
    portInUse: async () => false,
    isUp: async () => up.value,
    now: () => clock.value,
    ...patch,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-"));
  checkout = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-checkout-"));
  process.env.UPSTARTS_DIR = root;
});
afterEach(() => {
  for (const preview of listPreviews()) stopPreview(preview.taskId);
  vi.restoreAllMocks();
  if (ORIGINAL === undefined) delete process.env.UPSTARTS_DIR;
  else process.env.UPSTARTS_DIR = ORIGINAL;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(checkout, { recursive: true, force: true });
});

describe("preview config", () => {
  it("is opt-in per repo", () => {
    expect(readPreviewConfig("app")).toEqual({ reason: expect.stringContaining("has no upstarts/app/preview.json") });
    writeConfig("app", { autoStart: false });
    expect(readPreviewConfig("app")).toEqual({ reason: "app's preview config has autoStart off" });
    writeConfig("app", "{nope");
    expect(readPreviewConfig("app")).toEqual({ reason: expect.stringContaining("isn't valid JSON") });
    writeConfig("app", { autoStart: true, kind: "expo-web" });
    expect(readPreviewConfig("app")).toEqual({ config: expect.objectContaining({ kind: "expo-web", path: "/", readyTimeoutSec: 120 }) });
    expect(readPreviewConfig("../etc")).toEqual({ reason: expect.stringContaining("isn't a repo name") });
  });

  it("resolves owner/name to the upstarts directory and reports that path", () => {
    expect(readPreviewConfig("org/app")).toEqual({ reason: expect.stringContaining("has no upstarts/app/preview.json") });
    writeConfig("app", { autoStart: true });
    expect(readPreviewConfig("org/app")).toEqual({ config: expect.objectContaining({ autoStart: true }) });
    writeConfig("app", "{nope");
    expect(readPreviewConfig("org/app")).toEqual({ reason: "upstarts/app/preview.json isn't valid JSON" });
    expect(readPreviewConfig("org/..")).toEqual({ reason: expect.stringContaining("isn't a repo name") });
  });

  it("builds the dev or Expo web command", () => {
    expect(previewCommand(PreviewConfigSchema.parse({ autoStart: true }), 4100)).toBe("npm run dev");
    expect(previewCommand(PreviewConfigSchema.parse({ autoStart: true, kind: "expo-web" }), 4100)).toBe("npx expo start --web --port 4100");
    expect(previewCommand(PreviewConfigSchema.parse({ autoStart: true, command: "pnpm dev -p {port}" }), 4100)).toBe("pnpm dev -p 4100");
  });
});

describe("ensurePreview", () => {
  it("has no preview without a config or a checkout", async () => {
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, fakeDeps())).toMatchObject({ state: "none", reason: expect.stringContaining("The task has no preview URL") });
    writeConfig("app", { autoStart: true });
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: path.join(checkout, "gone") }, fakeDeps())).toMatchObject({ state: "none", reason: "No checkout to start the preview from." });
  });

  it("starts the server once, then reports the URL when it answers, and stops the process group", async () => {
    writeConfig("app", { autoStart: true, path: "/login" });
    const d = fakeDeps();
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d)).toMatchObject({ state: "starting", reason: "Starting the dev server: npm run dev" });
    expect(d.spawn).toHaveBeenCalledWith("npm run dev", expect.objectContaining({ cwd: checkout, env: expect.objectContaining({ PORT: "4100", BROWSER: "none" }) }));
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d)).toMatchObject({ state: "starting" });
    d.up.value = true;
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d)).toEqual({ state: "started", url: "http://localhost:4100/login", reason: "DevHub started the preview at http://localhost:4100/login." });
    expect(d.spawn).toHaveBeenCalledTimes(1);

    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    stopPreview("t1");
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(listPreviews()).toEqual([]);
  });

  it("gives up with the reason when the server exits or never answers", async () => {
    writeConfig("app", { autoStart: true, kind: "expo-web", readyTimeoutSec: 30 });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const d = fakeDeps();
    await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d);
    expect(d.spawn).toHaveBeenCalledWith("npx expo start --web --port 4100", expect.objectContaining({ env: expect.objectContaining({ CI: "1" }) }));
    const child = d.children[0] as unknown as EventEmitter & { stderr: EventEmitter };
    child.stderr.emit("data", "Error: expo not found\n");
    child.emit("exit", 1, null);
    expect(await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d)).toMatchObject({ state: "none", reason: expect.stringMatching(/exited \(code 1\).*expo not found/) });

    await ensurePreview({ taskId: "t2", repoName: "app", cwd: checkout }, d);
    d.clock.value += 31_000;
    expect(await ensurePreview({ taskId: "t2", repoName: "app", cwd: checkout }, d)).toMatchObject({ state: "none", reason: expect.stringContaining("didn't answer at http://localhost:4100/ within 30s") });
    expect(listPreviews()).toEqual([]);
  });

  it("restarts in a new checkout and refuses a configured port that is taken", async () => {
    writeConfig("app", { autoStart: true });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const d = fakeDeps();
    await ensurePreview({ taskId: "t1", repoName: "app", cwd: checkout }, d);
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-worktree-"));
    try {
      await ensurePreview({ taskId: "t1", repoName: "app", cwd: worktree }, d);
      expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(d.spawn).toHaveBeenLastCalledWith("npm run dev", expect.objectContaining({ cwd: worktree }));
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }

    writeConfig("web", { autoStart: true, port: 5000 });
    expect(await ensurePreview({ taskId: "t3", repoName: "web", cwd: checkout }, fakeDeps({ portInUse: async () => true }))).toMatchObject({ state: "none", reason: "Port 5000 from web's preview config is already in use." });
  });
});
