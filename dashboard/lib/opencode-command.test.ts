import { afterEach, describe, expect, it } from "vitest";
import { getOpenCodeEnv, resolveOpenCodeBindHost, resolveOpenCodePort } from "./opencode-command";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveOpenCodeBindHost", () => {
  it("prefers OPENCODE_BIND_HOST over legacy OPENCODE_HOST", () => {
    process.env.OPENCODE_BIND_HOST = "0.0.0.0";
    process.env.OPENCODE_HOST = "127.0.0.1";

    expect(resolveOpenCodeBindHost()).toBe("0.0.0.0");
  });

  it("falls back to legacy OPENCODE_HOST when not a URL", () => {
    delete process.env.OPENCODE_BIND_HOST;
    process.env.OPENCODE_HOST = "127.0.0.1";

    expect(resolveOpenCodeBindHost()).toBe("127.0.0.1");
  });

  it("ignores OPENCODE_HOST when it looks like a URL", () => {
    delete process.env.OPENCODE_BIND_HOST;
    process.env.OPENCODE_HOST = "http://127.0.0.1:1338";

    expect(resolveOpenCodeBindHost()).toBe("0.0.0.0");
  });
});

describe("resolveOpenCodePort", () => {
  it("defaults to 1338", () => {
    delete process.env.OPENCODE_PORT;
    expect(resolveOpenCodePort()).toBe(1338);
  });
});

describe("getOpenCodeEnv", () => {
  it("removes npm lifecycle variables", () => {
    process.env.npm_config_prefix = "/repo/dashboard";
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_package_json = "/repo/dashboard/package.json";
    process.env.OPENCODE_PORT = "1338";

    const env = getOpenCodeEnv();

    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.PATH).toContain(`${process.env.HOME}/.opencode/bin`);
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.npm_lifecycle_event).toBeUndefined();
    expect(env.npm_package_json).toBeUndefined();
  });
});
