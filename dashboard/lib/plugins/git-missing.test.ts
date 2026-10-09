import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/setup/git-availability", () => ({
  assessGitAvailability: vi.fn(async () => ({ runnable: false, bin: "/usr/bin/git", cltShim: true })),
  assessGitAvailabilitySync: vi.fn(() => ({ runnable: false, bin: "/usr/bin/git", cltShim: true })),
  clearGitAvailabilityCache: vi.fn(),
}));

import { diagnosticsFor, pluginContext, startPrepare, waitForOperation, type PluginContext } from "./operations";
import { GIT_MISSING_PLUGIN_MESSAGE } from "@/lib/setup/git-copy";
import type { CommandRunner } from "./source";

const roots: string[] = [];

function scratch(): PluginContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-git-"));
  roots.push(root);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: "/usr/bin",
    DEVHUB_VERSION: "2.0.3",
    DEVHUB_CONFIG_DIR: path.join(root, "config"),
    DEVHUB_PLUGIN_HOME: path.join(root, "managed"),
    DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "target"),
  };
  return pluginContext({ home: root, env, repoRoot: path.join(root, "repo") });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("adding a plugin without git", () => {
  it("returns GIT_MISSING instead of claiming the repository could not be accessed", async () => {
    const ctx = scratch();
    let calls = 0;
    const runner: CommandRunner = {
      async run(file) {
        calls += 1;
        throw new Error(`must not run ${file}`);
      },
    };
    ctx.runner = runner;
    const started = await startPrepare(ctx, "https://github.com/acme/widgets");
    const view = await waitForOperation(ctx, started.id);
    expect(view.state).toBe("git_missing");
    expect(view.message).toBe(GIT_MISSING_PLUGIN_MESSAGE);
    expect(view.message).toMatch(/Install Git/);
    expect(view.message).not.toMatch(/couldn't access|couldn’t access/i);
    expect(view.error?.code).toBe("GIT_MISSING");
    expect(calls).toBe(0);
    const diagnostic = diagnosticsFor(ctx, started.id);
    expect(diagnostic).toMatchObject({
      phase: "git_missing",
      errorCode: "GIT_MISSING",
      gitAvailable: false,
      appVersion: "2.0.3",
    });
    expect(diagnostic.appVersion).not.toContain("/Users/runner");
    expect(typeof diagnostic.ghAvailable).toBe("boolean");
  });
});
