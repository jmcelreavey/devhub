import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenCodeConfigured } from "./peer-service-availability";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DEVHUB_OPENCODE_BINARY;
  vi.resetModules();
});

describe("peer-service-availability", () => {
  it("detects explicit OpenCode binary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-"));
    dirs.push(dir);
    const bin = path.join(dir, "opencode");
    fs.writeFileSync(bin, "");
    process.env.DEVHUB_OPENCODE_BINARY = bin;
    expect(isOpenCodeConfigured()).toBe(true);
  });

  it("reports OpenCode unavailable when its binary is missing and no recap server runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-opencode-missing-"));
    dirs.push(dir);
    // A nonexistent explicit binary, so the result doesn't depend on whether
    // this machine has `opencode` installed.
    process.env.DEVHUB_OPENCODE_BINARY = path.join(dir, "no-such-opencode");
    const { getPeerServiceGateStatus } = await import("./peer-service-availability");
    const status = await getPeerServiceGateStatus();
    expect(status.opencode).toBe(false);
    expect(status).not.toHaveProperty("chamber");
  });
});
