import { describe, expect, it } from "vitest";
import { buildRunConsentRequest, shouldSkipDockChip } from "./terminal.ts";

describe("shouldSkipDockChip", () => {
  it("skips the chip only when the client elicited AND the user accepted", () => {
    expect(shouldSkipDockChip({ clientSupportsElicitation: true, userAccepted: true })).toBe(true);
    expect(shouldSkipDockChip({ clientSupportsElicitation: true, userAccepted: false })).toBe(false);
    expect(shouldSkipDockChip({ clientSupportsElicitation: true, userAccepted: null })).toBe(false);
    expect(shouldSkipDockChip({ clientSupportsElicitation: false, userAccepted: null })).toBe(false);
    // A client claiming elicitation support that never asked must not skip it.
    expect(shouldSkipDockChip({ clientSupportsElicitation: false, userAccepted: true })).toBe(false);
  });
});

describe("buildRunConsentRequest", () => {
  it("shows the command and requires an explicit boolean", () => {
    const req = buildRunConsentRequest("npm test");
    expect(req.message).toContain("npm test");
    expect(req.requestedSchema.type).toBe("object");
    expect(req.requestedSchema.properties.confirm.type).toBe("boolean");
    expect(req.requestedSchema.required).toEqual(["confirm"]);
  });

  it("clips long commands in the message", () => {
    const req = buildRunConsentRequest("x".repeat(1000));
    expect(req.message.length).toBeLessThan(500);
    expect(req.message.endsWith("…")).toBe(true);
  });
});
