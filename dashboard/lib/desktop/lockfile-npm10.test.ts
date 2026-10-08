import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard lockfile", () => {
  it("does not carry npm 11 libc markers", () => {
    const lock = readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8");
    expect(lock).not.toMatch(/"libc"\s*:/);
  });
});
