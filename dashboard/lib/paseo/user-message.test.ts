import { describe, expect, it } from "vitest";
import { PaseoUserError, paseoUserMessage } from "./user-message";

describe("paseoUserMessage", () => {
  it("passes through an error written for the user", () => {
    expect(paseoUserMessage(new PaseoUserError("Enter the existing Agents password."))).toBe("Enter the existing Agents password.");
  });
  it("reads the line the installer marks as safe, ignoring the rest of stderr", () => {
    const stderr = "npm WARN something with a token=abc\nDEVHUB_USER_MESSAGE: Port 6767 is occupied.\nstack trace";
    expect(paseoUserMessage(Object.assign(new Error("Command failed"), { stderr }))).toBe("Port 6767 is occupied.");
  });
  it("keeps unmarked diagnostics private", () => {
    expect(paseoUserMessage(Object.assign(new Error("Command failed: token=abc"), { stderr: "token=abc" }))).toBeNull();
    expect(paseoUserMessage(new Error("boom"))).toBeNull();
    expect(paseoUserMessage(null)).toBeNull();
  });
});
