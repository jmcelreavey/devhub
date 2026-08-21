import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chamberProcessPinsExternalOpenCode,
  cleanOpenChamberEnv,
  compareInstallVersions,
  openChamberInstallVersion,
  resolveOpenChamberBind,
  selectNewestOpenChamberBin,
  shouldReplaceOpenChamberListener,
} from "./openchamber-command";

const ORIGINAL_ENV = { ...process.env };
const tmpDirs: string[] = [];

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeInstall(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-chamber-"));
  tmpDirs.push(root);
  const pkg = path.join(root, "node_modules", "@openchamber", "web");
  fs.mkdirSync(path.join(pkg, "bin"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "server"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@openchamber/web", version }));
  const bin = path.join(pkg, "bin", "cli.js");
  fs.writeFileSync(bin, "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(pkg, "server", "index.js"), "/* daemon */\n");
  return bin;
}

describe("cleanOpenChamberEnv", () => {
  it("does not pin OpenChamber to DevHub's OpenCode peer", () => {
    process.env.OPENCODE_PORT = "1338";
    process.env.OPENCODE_HOST = "http://127.0.0.1:1338";
    process.env.OPENCODE_SKIP_START = "true";
    process.env.OPENCHAMBER_OPENCODE_PORT = "1338";
    process.env.OPENCHAMBER_SKIP_OPENCODE_START = "true";
    process.env.OPENCHAMBER_INTERNAL_PORT = "1338";

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBeUndefined();
    expect(env.OPENCODE_HOST).toBeUndefined();
    expect(env.OPENCODE_SKIP_START).toBeUndefined();
    expect(env.OPENCHAMBER_OPENCODE_PORT).toBeUndefined();
    expect(env.OPENCHAMBER_SKIP_OPENCODE_START).toBeUndefined();
    expect(env.OPENCHAMBER_INTERNAL_PORT).toBeUndefined();
  });

  it("does not inject OpenCode port or skip-start when unset", () => {
    delete process.env.OPENCODE_PORT;
    delete process.env.OPENCODE_HOST;
    delete process.env.OPENCODE_SKIP_START;

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBeUndefined();
    expect(env.OPENCODE_HOST).toBeUndefined();
    expect(env.OPENCODE_SKIP_START).toBeUndefined();
  });

  it("detects skip-start / pinned port in a ps eww dump", () => {
    expect(
      chamberProcessPinsExternalOpenCode(
        "bun server/index.js --port 1336 OPENCODE_PORT=1338 OPENCODE_SKIP_START=true HOME=/Users/me",
      ),
    ).toBe(true);
    expect(
      chamberProcessPinsExternalOpenCode("bun server/index.js --port 1336 OPENCODE_BINARY=/opt/opencode HOME=/Users/me"),
    ).toBe(false);
  });
});

describe("resolveOpenChamberBind", () => {
  const base: Record<string, string | undefined> = {};

  it("falls back to loopback when 0.0.0.0 is requested without UI auth", () => {
    // OpenChamber >=1.13 exits with code 4 binding a LAN address unauthenticated.
    const bind = resolveOpenChamberBind({ ...base, OPENCHAMBER_HOST: "0.0.0.0" });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.probe).toBe("127.0.0.1");
    expect(bind.note).toMatch(/UI auth/i);
  });

  it("defaults to loopback fallback when OPENCHAMBER_HOST is unset", () => {
    const bind = resolveOpenChamberBind({ ...base });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.note).toBeDefined();
  });

  it("keeps the LAN bind when a UI password is configured", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "0.0.0.0",
      OPENCHAMBER_UI_PASSWORD: "hunter2",
    });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.probe).toBe("127.0.0.1");
    expect(bind.note).toBeUndefined();
  });

  it("keeps the LAN bind when unauthenticated LAN is explicitly allowed", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "0.0.0.0",
      OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN: "true",
    });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.note).toBeUndefined();
  });

  it("leaves an explicit loopback host untouched", () => {
    const bind = resolveOpenChamberBind({ ...base, OPENCHAMBER_HOST: "127.0.0.1" });
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.note).toBeUndefined();
  });

  it("preserves a non-loopback LAN IP when authenticated", () => {
    const bind = resolveOpenChamberBind({
      ...base,
      OPENCHAMBER_HOST: "192.168.1.50",
      OPENCHAMBER_UI_PASSWORD: "pw",
    });
    expect(bind.host).toBe("192.168.1.50");
    expect(bind.probe).toBe("192.168.1.50");
  });
});

describe("selectNewestOpenChamberBin", () => {
  it("prefers the highest package version over PATH order", () => {
    const stale = writeInstall("1.11.3");
    const current = writeInstall("1.19.0");
    expect(openChamberInstallVersion(stale)).toBe("1.11.3");
    expect(openChamberInstallVersion(current)).toBe("1.19.0");
    expect(selectNewestOpenChamberBin([stale, current])).toBe(current);
    expect(selectNewestOpenChamberBin([current, stale])).toBe(current);
  });

  it("skips missing paths", () => {
    const current = writeInstall("1.19.0");
    expect(selectNewestOpenChamberBin(["/no/such/openchamber", current])).toBe(current);
  });
});

describe("compareInstallVersions", () => {
  it("orders dotted versions numerically", () => {
    expect(compareInstallVersions("1.19.0", "1.11.3")).toBeGreaterThan(0);
    expect(compareInstallVersions("1.11.3", "1.19.0")).toBeLessThan(0);
    expect(compareInstallVersions("1.19.0", "v1.19.0")).toBe(0);
  });
});

describe("shouldReplaceOpenChamberListener", () => {
  it("replaces a stale nvm install still bound to the Chamber port", () => {
    const stale = writeInstall("1.11.3");
    const current = writeInstall("1.19.0");
    const staleEntry = path.join(path.dirname(stale), "..", "server", "index.js");
    const currentEntry = path.join(path.dirname(current), "..", "server", "index.js");

    expect(
      shouldReplaceOpenChamberListener({
        cmdline: `bun ${staleEntry} --port 1336`,
        currentBin: current,
        currentEntry,
        currentVersion: "1.19.0",
      }),
    ).toBe(true);
  });

  it("keeps a current-version daemon even when the path differs", () => {
    const brew = writeInstall("1.19.0");
    const nvm = writeInstall("1.19.0");
    const brewEntry = path.join(path.dirname(brew), "..", "server", "index.js");
    const nvmEntry = path.join(path.dirname(nvm), "..", "server", "index.js");

    expect(
      shouldReplaceOpenChamberListener({
        cmdline: `bun ${brewEntry} --port 1336`,
        currentBin: nvm,
        currentEntry: nvmEntry,
        currentVersion: "1.19.0",
      }),
    ).toBe(false);
  });

  it("replaces an in-place upgrade whose process is still the old image", () => {
    const current = writeInstall("1.19.0");
    const entry = path.join(path.dirname(current), "..", "server", "index.js");
    expect(
      shouldReplaceOpenChamberListener({
        cmdline: `bun ${entry} --port 1336`,
        currentBin: current,
        currentEntry: entry,
        currentVersion: "1.19.0",
        entryMtimeMs: Date.now(),
        processAgeSeconds: 60 * 60,
      }),
    ).toBe(true);
  });
});
