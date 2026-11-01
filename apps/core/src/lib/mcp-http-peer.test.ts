import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mcpHttpAutostartEnabled,
  mcpHttpBaseEnv,
  mcpHttpEntry,
  mcpHttpPort,
  stalePeerPids,
  type PortListener,
} from "./mcp-http-peer";
import { resolvePluginPaths } from "./plugins/paths";
import { selectToolsets } from "../../../../packages/mcp/src/toolsets";

let dir: string;
const testEnv = { NODE_ENV: "test" as const };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-peer-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mcpHttpBaseEnv", () => {
  it.each([
    ["off", []],
    ["tasks,appraisal", ["tasks", "appraisal"]],
  ])("preserves the %s MCP selection", (selection, expected) => {
    const childEnv = mcpHttpBaseEnv({ ...testEnv, DEVHUB_MCP_TOOLSETS: selection });
    expect(selectToolsets(childEnv.DEVHUB_MCP_TOOLSETS, ["tasks", "appraisal", "terminal"]).names).toEqual(expected);
  });

  it("preserves the selected registry and toolsets without desktop content paths", () => {
    const configDir = path.join(dir, "config");
    const xdgConfigHome = path.join(dir, "xdg");
    expect(mcpHttpBaseEnv({
      ...testEnv,
      DEVHUB_CONFIG_DIR: configDir,
      DEVHUB_MCP_TOOLSETS: "off",
      DEVHUB_DESKTOP: "1",
      NOTES_DIR: "/desktop/notes",
      XDG_CONFIG_HOME: xdgConfigHome,
    })).toEqual({ ...testEnv, DEVHUB_CONFIG_DIR: configDir, DEVHUB_MCP_TOOLSETS: "off", XDG_CONFIG_HOME: xdgConfigHome });
    expect(mcpHttpBaseEnv({ ...testEnv, DEVHUB_CONFIG_DIR: "  ", DEVHUB_MCP_TOOLSETS: "tasks,appraisal" })).toEqual({ ...testEnv, DEVHUB_MCP_TOOLSETS: "tasks,appraisal" });
  });

  it.each(["career-config", "  .career-config/../career-config  "])("pins relative registry %s to the dashboard cwd", (configDir) => {
    const env = { ...testEnv, DEVHUB_CONFIG_DIR: configDir, DEVHUB_MCP_TOOLSETS: "off", DEVHUB_DESKTOP: "1" };
    const parentRegistry = resolvePluginPaths({ home: dir, env }).registryPath;
    const childEnv = mcpHttpBaseEnv(env);
    const childCwd = path.join(dir, "packages", "mcp");
    expect(path.isAbsolute(childEnv.DEVHUB_CONFIG_DIR ?? "")).toBe(true);
    expect(path.join(path.resolve(childCwd, childEnv.DEVHUB_CONFIG_DIR ?? ""), "plugins.json")).toBe(parentRegistry);
    expect(childEnv.DEVHUB_MCP_TOOLSETS).toBe("off");
    expect(childEnv.DEVHUB_DESKTOP).toBeUndefined();
  });

  it("pins a relative XDG fallback to the dashboard cwd", () => {
    const env = { ...testEnv, XDG_CONFIG_HOME: "  .relative-xdg/../xdg-config  ", DEVHUB_MCP_TOOLSETS: "tasks,appraisal" };
    const parentRegistry = resolvePluginPaths({ home: dir, env }).registryPath;
    const childEnv = mcpHttpBaseEnv(env);
    const childCwd = path.join(dir, "packages", "mcp");
    expect(path.isAbsolute(childEnv.XDG_CONFIG_HOME ?? "")).toBe(true);
    expect(path.join(path.resolve(childCwd, childEnv.XDG_CONFIG_HOME ?? ""), "devhub", "plugins.json")).toBe(parentRegistry);
    expect(childEnv.DEVHUB_MCP_TOOLSETS).toBe("tasks,appraisal");
  });

  describe.skipIf(process.platform === "win32")("WSL paths", () => {
    it("preserves a valid registry and toolset selection", () => {
      const env = { ...testEnv, WSL_DISTRO_NAME: "Debian", DEVHUB_CONFIG_DIR: dir, DEVHUB_MCP_TOOLSETS: "off", DEVHUB_DESKTOP: "1" };
      const childEnv = mcpHttpBaseEnv(env);
      expect(resolvePluginPaths({ home: dir, env: childEnv }).registryPath).toBe(resolvePluginPaths({ home: dir, env }).registryPath);
      expect(childEnv.DEVHUB_MCP_TOOLSETS).toBe("off");
      expect(childEnv.DEVHUB_DESKTOP).toBeUndefined();
    });

    it.each([
      { ...testEnv, DEVHUB_CONFIG_DIR: "career-config", WSL_DISTRO_NAME: "Debian", DEVHUB_MCP_TOOLSETS: "off" },
      { ...testEnv, XDG_CONFIG_HOME: "relative-xdg", WSL_DISTRO_NAME: "Debian", DEVHUB_MCP_TOOLSETS: "off" },
      { ...testEnv, DEVHUB_CONFIG_DIR: "  /tmp/career-config  ", WSL_DISTRO_NAME: "Debian", DEVHUB_MCP_TOOLSETS: "off" },
      { ...testEnv, DEVHUB_CONFIG_DIR: "/tmp/career-config", DEVHUB_PLUGIN_HOME: "/mnt/c/plugins", WSL_DISTRO_NAME: "Debian" },
      { ...testEnv, DEVHUB_CONFIG_DIR: "/tmp/career-config", DEVHUB_PLUGIN_TARGET_HOME: "/mnt/c/targets", WSL_DISTRO_NAME: "Debian" },
      { ...testEnv, DEVHUB_CONFIG_DIR: "/tmp/career-config", DEVHUB_APP_DATA: "/mnt/c/app-data", WSL_DISTRO_NAME: "Debian" },
    ])("rejects invalid plugin paths before scrubbing the child environment", (env) => {
      expect(() => resolvePluginPaths({ home: dir, env })).toThrow(/Plugin paths must use the Linux filesystem/);
      expect(() => mcpHttpBaseEnv(env)).toThrow(/Plugin paths must use the Linux filesystem/);
    });
  });
});

describe("mcpHttpPort", () => {
  it("uses DEVHUB_MCP_HTTP_PORT when valid, else 1340", () => {
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "1441" })).toBe(1441);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "nope" })).toBe(1340);
    expect(mcpHttpPort({ DEVHUB_MCP_HTTP_PORT: "70000" })).toBe(1340);
    expect(mcpHttpPort({})).toBe(1340);
  });

  it("keeps an invalid checkout port away from the installed peer", () => {
    expect(mcpHttpPort({ DEVHUB_CHECKOUT_DEV: "1", DEVHUB_MCP_HTTP_PORT: "1340invalid" })).toBe(1440);
    expect(mcpHttpPort({ DEVHUB_CHECKOUT_DEV: "1" })).toBe(1440);
    expect(mcpHttpPort({ DEVHUB_CHECKOUT_DEV: "1", DEVHUB_MCP_HTTP_PORT: "1340" })).toBe(1340);
  });
});

describe("mcpHttpAutostartEnabled", () => {
  it("is on by default and off for DEVHUB_MCP_HTTP=0 or tests", () => {
    expect(mcpHttpAutostartEnabled({})).toBe(true);
    expect(mcpHttpAutostartEnabled({ DEVHUB_MCP_HTTP: "0" })).toBe(false);
    expect(mcpHttpAutostartEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("stalePeerPids", () => {
  const entry = "/repo/packages/mcp/src/http.ts";
  const tsx = `node /repo/node_modules/tsx/dist/cli.mjs ${entry}`;
  const peer = (overrides: Partial<PortListener> & { env?: string }): PortListener => ({
    pid: 200,
    commandAndEnv: `node --require preflight.cjs ${entry} ${overrides.env ?? ""}`,
    launcherPid: 199,
    launcherCommand: tsx,
    launcherParentPid: 100,
    ...overrides,
  });
  const alive = (livePids: number[]) => (pid: number) => livePids.includes(pid);

  it("replaces a peer whose dashboard is gone, with its tsx launcher", () => {
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" })], entry, alive([]))).toEqual([200, 199]);
  });

  it("leaves a peer a live dashboard owns alone", () => {
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" })], entry, alive([100]))).toEqual([]);
  });

  it("replaces a legacy peer (no parent pid) whose launcher launchd adopted", () => {
    expect(stalePeerPids([peer({ launcherParentPid: 1 })], entry, alive([]))).toEqual([200, 199]);
    expect(stalePeerPids([peer({ launcherPid: 1, launcherCommand: "/sbin/launchd", launcherParentPid: 0 })], entry, alive([]))).toEqual([200]);
  });

  it("leaves a legacy peer with a live launcher chain alone", () => {
    expect(stalePeerPids([peer({ launcherParentPid: 100 })], entry, alive([100]))).toEqual([]);
  });

  it("never touches a port that has anything else on it", () => {
    const foreign = peer({ pid: 300, commandAndEnv: "python -m http.server 1340" });
    expect(stalePeerPids([foreign], entry, alive([]))).toEqual([]);
    expect(stalePeerPids([peer({ env: "DEVHUB_MCP_HTTP_PARENT_PID=100" }), foreign], entry, alive([]))).toEqual([]);
    expect(stalePeerPids([], entry, alive([]))).toEqual([]);
  });
});

describe("mcpHttpEntry", () => {
  it("needs both the installed tsx and the HTTP entry", () => {
    const pkg = path.join(dir, "packages", "mcp");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "http.ts"), "");
    expect(mcpHttpEntry(dir)).toBeNull();

    fs.mkdirSync(path.join(dir, "node_modules", "tsx", "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "tsx", "dist", "cli.mjs"), "");
    expect(mcpHttpEntry(dir)).toEqual({
      tsx: path.join(dir, "node_modules", "tsx", "dist", "cli.mjs"),
      entry: path.join(pkg, "src", "http.ts"),
      cwd: pkg,
    });
  });
});
