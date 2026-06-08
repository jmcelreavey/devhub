import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readManifest } from "./manifest";
import { listEnabledPlugins, pluginAssetDirs, expandHome, pluginRegistryPath } from "./registry";

let home: string;
let pluginRoot: string;

function writeRegistry(entries: unknown[]): void {
  const file = pluginRegistryPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ plugins: entries }, null, 2));
}

function makePlugin(dir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "devhub-plugin.json"), JSON.stringify(manifest, null, 2));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

describe("expandHome", () => {
  it("expands a leading tilde", () => {
    expect(expandHome("~/foo", "/Users/x")).toBe("/Users/x/foo");
    expect(expandHome("~", "/Users/x")).toBe("/Users/x");
  });
  it("resolves a bare tilde-less path to absolute", () => {
    expect(expandHome("/abs/path", "/Users/x")).toBe("/abs/path");
  });
});

describe("readManifest", () => {
  it("accepts a valid manifest", () => {
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "1", contributes: { agents: "agents/" } });
    const res = readManifest(pluginRoot);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.manifest.name).toBe("bi");
  });
  it("rejects an unsupported devhubApi", () => {
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "99", contributes: {} });
    const res = readManifest(pluginRoot);
    expect(res.ok).toBe(false);
  });
  it("rejects an invalid name slug", () => {
    makePlugin(pluginRoot, { name: "BI Plugin", version: "0.1.0", devhubApi: "1", contributes: {} });
    expect(readManifest(pluginRoot).ok).toBe(false);
  });
  it("reports a missing manifest without throwing", () => {
    expect(readManifest(pluginRoot).ok).toBe(false);
  });
});

describe("listEnabledPlugins", () => {
  it("returns [] when no registry file exists", () => {
    expect(listEnabledPlugins(home)).toEqual([]);
  });

  it("loads an enabled plugin and skips a disabled one", () => {
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "1", contributes: { agents: "agents/" } });
    writeRegistry([
      { name: "bi", path: pluginRoot, enabled: true },
      { name: "off", path: pluginRoot, enabled: false },
    ]);
    const plugins = listEnabledPlugins(home);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("bi");
  });

  it("skips entries whose path is missing", () => {
    writeRegistry([{ name: "ghost", path: path.join(pluginRoot, "nope"), enabled: true }]);
    expect(listEnabledPlugins(home)).toEqual([]);
  });

  it("skips a registry name that disagrees with the manifest name", () => {
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "1", contributes: {} });
    writeRegistry([{ name: "wrong", path: pluginRoot, enabled: true }]);
    expect(listEnabledPlugins(home)).toEqual([]);
  });

  it("dedupes plugins by name", () => {
    const a = path.join(pluginRoot, "a");
    const b = path.join(pluginRoot, "b");
    makePlugin(a, { name: "dup", version: "1", devhubApi: "1", contributes: {} });
    makePlugin(b, { name: "dup", version: "2", devhubApi: "1", contributes: {} });
    writeRegistry([
      { path: a, enabled: true },
      { path: b, enabled: true },
    ]);
    expect(listEnabledPlugins(home)).toHaveLength(1);
  });

  it("does not throw on invalid registry JSON", () => {
    const file = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(listEnabledPlugins(home)).toEqual([]);
  });
});

describe("pluginAssetDirs", () => {
  it("returns existing contributed dirs tagged with origin", () => {
    fs.mkdirSync(path.join(pluginRoot, "agents"), { recursive: true });
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "1", contributes: { agents: "agents/", docs: "docs/" } });
    writeRegistry([{ name: "bi", path: pluginRoot, enabled: true }]);

    const dirs = pluginAssetDirs("agents", home);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].origin).toBe("plugin:bi");
    expect(dirs[0].dir).toBe(path.join(pluginRoot, "agents"));

    // docs declared but the dir doesn't exist -> skipped
    expect(pluginAssetDirs("docs", home)).toEqual([]);
  });

  it("rejects a contributes path that escapes the plugin root", () => {
    makePlugin(pluginRoot, { name: "bi", version: "0.1.0", devhubApi: "1", contributes: { agents: "../escape" } });
    writeRegistry([{ name: "bi", path: pluginRoot, enabled: true }]);
    expect(pluginAssetDirs("agents", home)).toEqual([]);
  });
});
