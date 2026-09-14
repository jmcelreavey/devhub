import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRuntimeInfo,
  DASHBOARD_FEATURES,
  dashboardRuntimePath,
  isRuntimeAlive,
  readDashboardRuntime,
  writeDashboardRuntime,
} from "./dashboard-runtime";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-runtime-"));
  file = path.join(dir, "dashboard.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dashboardRuntimePath", () => {
  /** Beside plugins.json — machine-local, never inside a repo. */
  it("lives in ~/.config/devhub", () => {
    expect(dashboardRuntimePath("/home/x")).toBe("/home/x/.config/devhub/dashboard.json");
  });
});

describe("buildRuntimeInfo", () => {
  it("advertises this process and its features", () => {
    const info = buildRuntimeInfo();
    expect(info.pid).toBe(process.pid);
    expect(info.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(info.features).toEqual([...DASHBOARD_FEATURES]);
  });

  /** The whole point: a client can ask "does this instance serve /api/db?". */
  it("includes the db feature tag", () => {
    expect(buildRuntimeInfo().features).toContain("db");
  });
});

describe("write / read", () => {
  it("round-trips", () => {
    writeDashboardRuntime(file);
    const info = readDashboardRuntime(file);
    expect(info?.pid).toBe(process.pid);
    expect(info?.features).toContain("db");
  });

  it("creates the directory when it does not exist", () => {
    const nested = path.join(dir, "a", "b", "dashboard.json");
    writeDashboardRuntime(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("returns null for a missing file", () => {
    expect(readDashboardRuntime(path.join(dir, "absent.json"))).toBeNull();
  });

  it("returns null for a malformed file rather than throwing", () => {
    fs.writeFileSync(file, "{not json");
    expect(readDashboardRuntime(file)).toBeNull();
  });

  it("returns null when the payload has no baseUrl", () => {
    fs.writeFileSync(file, JSON.stringify({ pid: 1 }));
    expect(readDashboardRuntime(file)).toBeNull();
  });

  /**
   * Advertising is a convenience. An unwritable path must not stop the server
   * from starting.
   */
  it("does not throw when the file cannot be written", () => {
    // Nest under a regular file so mkdir fails with ENOTDIR on every OS, even as root.
    // A /proc path did this on macOS but spun forever in mkdirSync on Linux CI.
    fs.writeFileSync(file, "");
    expect(() => writeDashboardRuntime(path.join(file, "nested", "dashboard.json"))).not.toThrow();
  });
});

describe("isRuntimeAlive", () => {
  it("recognises this process", () => {
    expect(isRuntimeAlive(buildRuntimeInfo())).toBe(true);
  });

  /** A crashed server leaves its file behind; pointing at it is worse than nothing. */
  it("rejects a pid that is gone", () => {
    // Above the default pid_max on Linux and macOS, so it cannot be a live process.
    expect(isRuntimeAlive({ ...buildRuntimeInfo(), pid: 4_194_305 })).toBe(false);
  });

  it("rejects a missing pid", () => {
    expect(isRuntimeAlive({ ...buildRuntimeInfo(), pid: 0 })).toBe(false);
  });
});
