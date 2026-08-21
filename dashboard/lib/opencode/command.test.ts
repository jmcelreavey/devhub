import { afterEach, describe, expect, it } from "vitest";
import { getOpenCodeEnv } from "@/lib/opencode/command";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
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
