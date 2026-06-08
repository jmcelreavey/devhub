import { describe, expect, it, afterEach } from "vitest";
import { resolveDatadogApplicationKey } from "./datadog-application-key";

const empty = new Map<string, string>();

describe("resolveDatadogApplicationKey", () => {
  afterEach(() => {
    delete process.env.DATADOG_APPLICATION_KEY;
    delete process.env.DD_APPLICATION_KEY;
    delete process.env.DATADOG_APP_KEY;
  });

  it("prefers DATADOG_APPLICATION_KEY from overrides", () => {
    const o = new Map(empty);
    o.set("DATADOG_APPLICATION_KEY", "from-file");
    process.env.DATADOG_APP_KEY = "from-shell";
    expect(resolveDatadogApplicationKey(o)).toBe("from-file");
  });

  it("falls back to DATADOG_APP_KEY in process.env", () => {
    process.env.DATADOG_APP_KEY = "app-key-alias";
    expect(resolveDatadogApplicationKey(empty)).toBe("app-key-alias");
  });
});
