import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenChamberConfigured, isOpenCodeConfigured } from "./peer-service-availability";

const dirs: string[] = [];
const originalEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  SHELL: process.env.SHELL,
  USERPROFILE: process.env.USERPROFILE,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.OPENCHAMBER_BIN;
  delete process.env.DEVHUB_OPENCODE_BINARY;
  delete process.env.OPENCODE_PORT;
  delete process.env.OPENCHAMBER_PORT;
  process.env.HOME = originalEnv.HOME;
  process.env.PATH = originalEnv.PATH;
  process.env.SHELL = originalEnv.SHELL;
  process.env.USERPROFILE = originalEnv.USERPROFILE;
  vi.resetModules();
});

describe("peer-service-availability", () => {
  it("detects OpenChamber via an explicit OPENCHAMBER_BIN", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-"));
    dirs.push(dir);
    const bin = path.join(dir, "openchamber");
    fs.writeFileSync(bin, "#!/bin/sh\n");
    process.env.OPENCHAMBER_BIN = bin;
    expect(isOpenChamberConfigured()).toBe(true);
  });

  it("reports OpenChamber unconfigured when OPENCHAMBER_BIN points at nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-missing-"));
    dirs.push(dir);
    process.env.OPENCHAMBER_BIN = path.join(dir, "no-such-openchamber");
    expect(isOpenChamberConfigured()).toBe(false);
  });

  it("detects OpenChamber installed under another nvm node version", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-nvm-"));
    dirs.push(home);
    const bin = path.join(home, ".nvm", "versions", "node", "v22.0.0", "bin", "openchamber");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, "#!/bin/sh\n");

    process.env.HOME = home;
    delete process.env.USERPROFILE;
    process.env.PATH = path.join(home, "empty-bin");
    process.env.SHELL = path.join(home, "missing-shell");

    vi.resetModules();
    const { isOpenChamberConfigured } = await import("./peer-service-availability");
    expect(isOpenChamberConfigured()).toBe(true);
  });

  it("detects explicit OpenCode binary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-"));
    dirs.push(dir);
    const bin = path.join(dir, "opencode");
    fs.writeFileSync(bin, "");
    process.env.DEVHUB_OPENCODE_BINARY = bin;
    expect(isOpenCodeConfigured()).toBe(true);
  });

  it("hides chamber when OpenChamber exists but OpenCode does not", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-gate-"));
    dirs.push(dir);
    const bin = path.join(dir, "openchamber");
    fs.writeFileSync(bin, "#!/bin/sh\n");
    process.env.OPENCHAMBER_BIN = bin;
    // Force OpenCode unavailable regardless of the host environment: point at a
    // nonexistent binary and probe ports nothing is listening on. Without this the
    // test fails on dev machines where `opencode` is installed/running.
    process.env.DEVHUB_OPENCODE_BINARY = path.join(dir, "no-such-opencode");
    process.env.OPENCODE_PORT = "59123";
    process.env.OPENCHAMBER_PORT = "59124";
    const { getPeerServiceGateStatus } = await import("./peer-service-availability");
    const status = await getPeerServiceGateStatus();
    expect(status.opencode).toBe(false);
    expect(status.chamber).toBe(false);
  });
});
