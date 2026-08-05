import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { augmentedPathEnv, extraPathSegments, scrubDesktopRuntimeEnv, scrubNpmEnv } from "./process-env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("scrubNpmEnv", () => {
  it("removes npm lifecycle and config variables", () => {
    const env = scrubNpmEnv({
      HOME: "/tmp/home",
      NODE_ENV: "production",
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
    expect(env.PATH).toContain(path.dirname(process.execPath));
    expect(env.PATH).toContain(`${process.env.HOME}/Library/Python/3.9/bin`);
    expect(env.PATH).toContain(`${process.env.HOME}/.opencode/bin`);
    expect(env.PATH).toContain(`${process.env.HOME}/.npm/bin`);
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.npm_lifecycle_event).toBeUndefined();
  });

  it("augments an explicitly supplied PATH and HOME", () => {
    const env = augmentedPathEnv({ HOME: "/tmp/other-home", PATH: "/custom/bin" });

    expect(env.PATH?.split(path.delimiter)).toEqual(
      expect.arrayContaining(["/custom/bin", "/tmp/other-home/.opencode/bin", "/tmp/other-home/.local/bin"]),
    );
  });

  it("does not invent home-relative paths when HOME is absent", () => {
    expect(extraPathSegments(undefined)).not.toContain("/.local/bin");
    expect(extraPathSegments(undefined)).not.toContain("/.opencode/bin");
  });
});

describe("scrubDesktopRuntimeEnv", () => {
  it("drops desktop layout vars but keeps op helpers", () => {
    const env = scrubDesktopRuntimeEnv({
      HOME: "/tmp/home",
      PATH: "/usr/bin",
      NODE_ENV: "production",
      PORT: "1337",
      DEVHUB_DESKTOP: "1",
      DEVHUB_APP_DATA: "/tmp/app-data",
      DEVHUB_SERVER_DIR: "/Applications/DevHub.app/Contents/Resources/server",
      DEVHUB_OP_VAULT: "Private",
      NOTES_DIR: "/tmp/app-data/notes",
      TASKS_DIR: "/tmp/app-data/tasks",
      OPENCODE_PORT: "1338",
      __NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify({ distDir: ".next" }),
      __NEXT_PRIVATE_RENDER_WORKER: "1",
    } as NodeJS.ProcessEnv);

    expect(env.HOME).toBe("/tmp/home");
    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.DEVHUB_OP_VAULT).toBe("Private");
    expect(env.DEVHUB_DESKTOP).toBeUndefined();
    expect(env.DEVHUB_APP_DATA).toBeUndefined();
    expect(env.DEVHUB_SERVER_DIR).toBeUndefined();
    expect(env.NOTES_DIR).toBeUndefined();
    expect(env.TASKS_DIR).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.PORT).toBeUndefined();
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined();
    expect(env.__NEXT_PRIVATE_RENDER_WORKER).toBeUndefined();
  });
});
