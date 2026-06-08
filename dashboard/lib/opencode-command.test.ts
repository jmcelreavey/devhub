import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenCodeBindHost, resolveOpenCodePort } from "./opencode-command";

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
