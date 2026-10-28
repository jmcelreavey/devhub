import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginPaths } from "./paths";
import { isolatePluginsForVerify } from "./verify-isolation";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("isolatePluginsForVerify", () => {
  it("leaves the machine's plugin registry alone without the flag", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DEVHUB_CONFIG_DIR: "/home/me/.config/devhub" };
    expect(isolatePluginsForVerify(env)).toBeNull();
    expect(env.DEVHUB_CONFIG_DIR).toBe("/home/me/.config/devhub");
  });

  it("resolves plugins from an empty registry when verify asks for core only", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      DEVHUB_VERIFY_CORE_ONLY: "1",
      DEVHUB_CONFIG_DIR: "/home/me/.config/devhub",
      DEVHUB_PLUGIN_HOME: "/home/me/plugins",
    };
    const dir = isolatePluginsForVerify(env);
    expect(dir).not.toBeNull();
    made.push(dir!);

    const paths = resolvePluginPaths({ home: "/home/me", env });
    expect(paths.registryPath.startsWith(dir!)).toBe(true);
    expect(paths.pluginHome.startsWith(dir!)).toBe(true);
    expect(fs.existsSync(paths.registryPath)).toBe(false);
  });
});
