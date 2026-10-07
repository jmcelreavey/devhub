import { describe, expect, it } from "vitest";
import { requestedSetupStep } from "./progress";

describe("requestedSetupStep", () => {
  it("accepts a known step", () => {
    expect(requestedSetupStep("?step=github")).toBe("github");
    expect(requestedSetupStep("calendar_connected=1&step=paths")).toBe("paths");
  });
  it("ignores unknown or missing steps", () => {
    expect(requestedSetupStep("?step=nope")).toBeNull();
    expect(requestedSetupStep("")).toBeNull();
  });
});
