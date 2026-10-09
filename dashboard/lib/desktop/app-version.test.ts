import { describe, expect, it } from "vitest";
import { readAppVersion } from "./app-version";

describe("readAppVersion", () => {
  it("reads DEVHUB_VERSION at call time and never invents a CI home", () => {
    expect(readAppVersion({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3" })).toBe("2.0.3");
    expect(readAppVersion({ NODE_ENV: "test", DEVHUB_VERSION: "  " })).toBe("unknown");
    expect(readAppVersion({ NODE_ENV: "test" })).toBe("unknown");
    expect(readAppVersion({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3" })).not.toContain("/Users/runner");
  });
});
