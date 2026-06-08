import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isOpenChamberConfigured, isOpenCodeConfigured } from "./peer-service-availability";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.OPENCHAMBER_BIN;
  delete process.env.DEVHUB_OPENCODE_BINARY;
});

describe("peer-service-availability", () => {
  it("detects local OpenChamber install", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-"));
    dirs.push(dir);
    const binDir = path.join(dir, "node_modules", "@openchamber", "web", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "cli.js"), "console.log('ok')");
    expect(isOpenChamberConfigured(dir)).toBe(true);
  });

  it("detects explicit OpenCode binary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-"));
    dirs.push(dir);
    const bin = path.join(dir, "opencode");
    fs.writeFileSync(bin, "");
    process.env.DEVHUB_OPENCODE_BINARY = bin;
    expect(isOpenCodeConfigured()).toBe(true);
  });
});
