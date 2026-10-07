import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { managedEnv, loadEnvFile } from "./supervisor.mjs";

test("packaged children never install globals inside the runtime payload", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tools-"));
  const previous = { ...process.env };
  try {
    process.env.HOME = home;
    process.env.NPM_CONFIG_PREFIX = "/app/runtime/hash";
    process.env.npm_config_prefix = "/app/runtime/hash";
    const env = managedEnv();
    assert.equal(env.NPM_CONFIG_PREFIX, path.join(home, ".local/share/devhub/tools"));
    assert.equal(env.npm_config_prefix, env.NPM_CONFIG_PREFIX);
    assert.equal(env.PATH.split(path.delimiter)[0], path.join(env.NPM_CONFIG_PREFIX, "bin"));
    assert.ok(fs.statSync(env.NPM_CONFIG_PREFIX).isDirectory());
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a linked config cannot re-enable a secondary instance's scheduler", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-secondary-"));
  const previous = process.env.DEVHUB_SCHEDULER;
  try {
    const file = path.join(dir, "config");
    fs.writeFileSync(file, "DEVHUB_SCHEDULER=1\n");
    process.env.DEVHUB_SCHEDULER = "0";
    loadEnvFile(file);
    assert.equal(process.env.DEVHUB_SCHEDULER, "0");
  } finally {
    if (previous === undefined) delete process.env.DEVHUB_SCHEDULER;
    else process.env.DEVHUB_SCHEDULER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
