import { afterEach, describe, expect, it } from "vitest";
import { cleanOpenChamberEnv } from "./openchamber-command";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("cleanOpenChamberEnv", () => {
  it("chains OpenChamber to shared OpenCode on OPENCODE_PORT", () => {
    process.env.OPENCODE_PORT = "1338";
    process.env.OPENCODE_HOST = "127.0.0.1";

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.OPENCODE_SKIP_START).toBe("true");
    expect(env.OPENCODE_HOST).toBeUndefined();
  });

  it("defaults OPENCODE_PORT to 1338 when unset", () => {
    delete process.env.OPENCODE_PORT;
    delete process.env.OPENCODE_HOST;

    const env = cleanOpenChamberEnv();

    expect(env.OPENCODE_PORT).toBe("1338");
    expect(env.OPENCODE_SKIP_START).toBe("true");
  });
});
