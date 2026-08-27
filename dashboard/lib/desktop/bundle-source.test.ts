import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPackagedCheckoutStatus,
  readBundleSourceCommit,
  readCheckoutHeadCommit,
} from "./bundle-source";

const ENV_KEYS = [
  "DEVHUB_PACKAGED_RUNTIME",
  "DEVHUB_SERVER_DIR",
  "DEVHUB_DESKTOP",
  "DEVHUB_APP_DATA",
  "REPO_ROOT",
] as const;

let tmp = "";
const saved: Record<string, string | undefined> = {};

function makeCheckout(name = "checkout"): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README"), "test\n");
  spawnSync("git", ["add", "README"], { cwd: dir });
  spawnSync("git", ["commit", "-qm", "init"], { cwd: dir });
  return dir;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-bundle-source-"));
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readBundleSourceCommit", () => {
  it("reads the commit from bundle-source.json", () => {
    const server = path.join(tmp, "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(
      path.join(server, "bundle-source.json"),
      JSON.stringify({ commit: "abc123def456" }),
    );
    expect(readBundleSourceCommit(server)).toBe("abc123def456");
  });

  it("returns null when the marker is missing", () => {
    expect(readBundleSourceCommit(path.join(tmp, "missing"))).toBeNull();
  });
});

describe("getPackagedCheckoutStatus", () => {
  it("is inactive outside packaged runtime", () => {
    const checkout = makeCheckout();
    process.env.REPO_ROOT = checkout;
    expect(getPackagedCheckoutStatus()).toMatchObject({
      packagedRuntime: false,
      stale: false,
    });
  });

  it("reports stale when checkout HEAD differs from the bundle marker", () => {
    const checkout = makeCheckout();
    const server = path.join(tmp, "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(
      path.join(server, "bundle-source.json"),
      JSON.stringify({ commit: "deadbeef".padEnd(40, "0") }),
    );

    process.env.DEVHUB_PACKAGED_RUNTIME = "1";
    process.env.DEVHUB_DESKTOP = "1";
    process.env.DEVHUB_APP_DATA = path.join(tmp, "app-data");
    fs.mkdirSync(process.env.DEVHUB_APP_DATA, { recursive: true });
    fs.writeFileSync(path.join(process.env.DEVHUB_APP_DATA, "repo-path.txt"), `${checkout}\n`);
    process.env.DEVHUB_SERVER_DIR = server;

    const head = readCheckoutHeadCommit(checkout);
    expect(head).toBeTruthy();

    const status = getPackagedCheckoutStatus();
    expect(status.stale).toBe(true);
    expect(status.checkoutCommit).toBe(head);
    expect(status.bundleCommit).not.toBe(head);
    expect(status.reason).toMatch(/Rebuild/);
  });

  it("stays quiet when bundle marker matches checkout HEAD", () => {
    const checkout = makeCheckout();
    const head = readCheckoutHeadCommit(checkout);
    expect(head).toBeTruthy();

    const server = path.join(tmp, "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(
      path.join(server, "bundle-source.json"),
      JSON.stringify({ commit: head }),
    );

    process.env.DEVHUB_PACKAGED_RUNTIME = "1";
    process.env.DEVHUB_DESKTOP = "1";
    process.env.DEVHUB_APP_DATA = path.join(tmp, "app-data");
    fs.mkdirSync(process.env.DEVHUB_APP_DATA, { recursive: true });
    fs.writeFileSync(path.join(process.env.DEVHUB_APP_DATA, "repo-path.txt"), `${checkout}\n`);
    process.env.DEVHUB_SERVER_DIR = server;

    expect(getPackagedCheckoutStatus()).toMatchObject({ stale: false });
  });
});
