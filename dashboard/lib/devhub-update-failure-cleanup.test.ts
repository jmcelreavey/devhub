import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("devhub-update failure cleanup", () => {
  it("preserves personal-path edits when git apply --3way fails", () => {
    const script = path.resolve(__dirname, "../../scripts/devhub-update.failure-cleanup.test.sh");
    const out = execFileSync("bash", [script], { encoding: "utf8" });
    expect(out).toContain("OK — personal-path edits preserved");
  });
});
