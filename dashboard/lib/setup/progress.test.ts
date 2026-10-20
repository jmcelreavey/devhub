import { describe, expect, it } from "vitest";
import { requestedSetupStep } from "./progress";

describe("requestedSetupStep", () => {
  it("accepts a known step", () => {
    expect(requestedSetupStep("?step=github")).toBe("github");
    expect(requestedSetupStep("calendar_connected=1&step=paths")).toBe("paths");
  });
  it("opens Slack from either a hash or the existing step query, even when goals hide it", () => {
    expect(requestedSetupStep("", "#slack")).toBe("slack");
    expect(requestedSetupStep("?step=slack")).toBe("slack");
    expect(requestedSetupStep("?step=github", "#slack")).toBe("github");
    expect(requestedSetupStep("", "#unknown")).toBeNull();
  });
  it("ignores unknown or missing steps", () => {
    expect(requestedSetupStep("?step=nope")).toBeNull();
    expect(requestedSetupStep("")).toBeNull();
  });
});
