import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEnabledPlugins, pluginRegistryPath } from "./registry";
import { registerPlugin, setPluginEnabled } from "./registry-write";

let home: string;
let pluginDir: string;

function makePlugin(name = "tools"): string {
  const dir = path.join(home, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "devhub-plugin.json"), JSON.stringify({
    name, version: "1.0.0", devhubApi: "1", contributes: {},
  }));
  return fs.realpathSync(dir);
}
function save(contents: unknown): string {
  const file = pluginRegistryPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(contents);
  fs.writeFileSync(file, text);
  return text;
}
function read(): { plugins: Array<Record<string, unknown>>; schemaVersion?: number } {
  return JSON.parse(fs.readFileSync(pluginRegistryPath(home), "utf8"));
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-register-")));
  pluginDir = makePlugin();
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("plugin registry edits", () => {
  it("registers the manifest name and supports repeated registration", async () => {
    await registerPlugin(pluginDir, home);
    await registerPlugin(pluginDir, home);
    expect(read().plugins).toEqual([{ name: "tools", path: pluginDir, enabled: true }]);
    expect(listEnabledPlugins(home).map(plugin => plugin.name)).toEqual(["tools"]);
  });

  it("preserves other entries, extra options and top-level metadata", async () => {
    const other = makePlugin("other");
    save({ schemaVersion: 2, plugins: [
      { name: "other", path: other, enabled: true },
      { name: "tools", path: pluginDir, enabled: false, gitRefresh: true, label: "Keep this" },
    ] });
    await registerPlugin(pluginDir, home);
    expect(read()).toEqual({ schemaVersion: 2, plugins: [
      { name: "other", path: other, enabled: true },
      { name: "tools", path: pluginDir, enabled: true, gitRefresh: true, label: "Keep this" },
    ] });
  });

  it("moves an existing registration when the same plugin is cloned elsewhere", async () => {
    const oldDir = pluginDir;
    await registerPlugin(oldDir, home);
    const newDir = path.join(home, "new-copy");
    fs.cpSync(oldDir, newDir, { recursive: true });
    await registerPlugin(newDir, home);
    expect(read().plugins).toEqual([{ name: "tools", path: newDir, enabled: true }]);
  });

  it("refuses an invalid manifest before touching the registry", async () => {
    const original = save({ plugins: [] });
    fs.writeFileSync(path.join(pluginDir, "devhub-plugin.json"), "{}");
    await expect(registerPlugin(pluginDir, home)).rejects.toThrow("invalid manifest");
    expect(fs.readFileSync(pluginRegistryPath(home), "utf8")).toBe(original);
  });

  it.each(["{ broken", '{"plugins":{}}'])("keeps a malformed registry intact: %s", async original => {
    const file = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);
    await expect(registerPlugin(pluginDir, home)).rejects.toThrow("Invalid plugin registry");
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("serializes concurrent registrations without losing either plugin", async () => {
    await Promise.all([registerPlugin(pluginDir, home), registerPlugin(makePlugin("other"), home)]);
    expect(listEnabledPlugins(home).map(plugin => plugin.name).sort()).toEqual(["other", "tools"]);
  });

  it("disables and re-enables a plugin without removing its configuration", async () => {
    await registerPlugin(pluginDir, home);
    await setPluginEnabled("tools", false, home);
    expect(listEnabledPlugins(home)).toEqual([]);
    await setPluginEnabled("tools", true, home);
    expect(listEnabledPlugins(home).map(plugin => plugin.name)).toEqual(["tools"]);
  });

  it("can disable a missing plugin but refuses to enable it", async () => {
    await registerPlugin(pluginDir, home);
    fs.rmSync(pluginDir, { recursive: true });
    await setPluginEnabled("tools", false, home);
    const original = fs.readFileSync(pluginRegistryPath(home), "utf8");
    await expect(setPluginEnabled("tools", true, home)).rejects.toThrow("missing devhub-plugin.json");
    expect(fs.readFileSync(pluginRegistryPath(home), "utf8")).toBe(original);
  });
});
