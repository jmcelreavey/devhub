import { afterEach, describe, expect, it } from "vitest";
import { augmentedPathEnv, scrubNpmEnv } from "./process-env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("scrubNpmEnv", () => {
  it("removes npm lifecycle and config variables", () => {
    const env = scrubNpmEnv({
      HOME: "/tmp/home",
      NODE_ENV: "test",
      PATH: "/usr/bin",
      INIT_CWD: "/repo",
      npm_command: "run",
      npm_config_prefix: "/repo/dashboard",
      npm_config_userconfig: "/tmp/.npmrc",
      npm_lifecycle_event: "dev",
      npm_lifecycle_script: "next dev",
      npm_node_execpath: "/opt/node",
      npm_package_engines_node: ">=20",
      npm_package_json: "/repo/dashboard/package.json",
      npm_package_name: "dashboard",
      OPENCODE_PORT: "1338",
    });

    expect(env.HOME).toBe("/tmp/home");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.INIT_CWD).toBeUndefined();
    expect(env.npm_command).toBeUndefined();
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.npm_config_userconfig).toBeUndefined();
    expect(env.npm_lifecycle_event).toBeUndefined();
    expect(env.npm_lifecycle_script).toBeUndefined();
    expect(env.npm_node_execpath).toBeUndefined();
    expect(env.npm_package_engines_node).toBeUndefined();
    expect(env.npm_package_json).toBeUndefined();
    expect(env.npm_package_name).toBeUndefined();
  });
});

describe("augmentedPathEnv", () => {
  it("augments PATH without preserving npm lifecycle variables", () => {
    process.env.PATH = "/usr/bin";
    process.env.npm_config_prefix = "/repo/dashboard";
    process.env.npm_lifecycle_event = "dev";

    const env = augmentedPathEnv();

    expect(env.PATH).toContain("/usr/bin");
    expect(env.PATH).toContain("/opt/homebrew/bin");
    expect(env.PATH).toContain(`${process.env.HOME}/Library/Python/3.9/bin`);
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.npm_lifecycle_event).toBeUndefined();
  });
});
