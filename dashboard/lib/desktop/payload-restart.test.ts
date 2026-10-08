import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RebuildStatus } from "./checkout-rebuild";
import { payloadRestartStatus } from "./payload-restart";

function status(state: RebuildStatus["state"]): RebuildStatus {
  return { state, phase: null, phases: [], error: "stopped", rolledBack: false, restartRequired: false, commit: "newer-attempt" };
}

describe("payloadRestartStatus", () => {
  let appData: string;
  let payload: string;

  beforeEach(() => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-payload-restart-"));
    payload = path.join(appData, "runtime/local-built");
    fs.mkdirSync(payload, { recursive: true });
    fs.mkdirSync(path.join(appData, "config"));
    fs.writeFileSync(path.join(payload, ".complete"), "");
    fs.writeFileSync(path.join(appData, "config/local-payload.json"), JSON.stringify({ dir: payload, commit: "built" }));
  });

  afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

  it.each(["interrupted", "failed", "running"] as const)("retains the pending completed build after a %s attempt", (state) => {
    expect(payloadRestartStatus(appData, "running", status(state))).toEqual({ ...status(state), restartRequired: true });
  });

  it("clears the offer once the recorded commit is running, even with an old success flag", () => {
    expect(payloadRestartStatus(appData, "built", { ...status("succeeded"), restartRequired: true })?.restartRequired).toBe(false);
  });

  it("can offer a completed build when the transient status file is missing", () => {
    expect(payloadRestartStatus(appData, "running", null)).toMatchObject({ state: "succeeded", commit: "built", restartRequired: true });
  });

  it("never offers an incomplete payload or promotes a failed attempt", () => {
    fs.unlinkSync(path.join(payload, ".complete"));
    expect(payloadRestartStatus(appData, "running", status("failed"))?.restartRequired).toBe(false);
    expect(payloadRestartStatus(appData, "running", null)).toBeNull();
  });

  it("keeps the last successful status as a fallback, but not after it is loaded", () => {
    fs.writeFileSync(path.join(appData, "config/local-payload.json"), "broken");
    const succeeded = { ...status("succeeded"), restartRequired: true, commit: "built" };
    expect(payloadRestartStatus(appData, "running", succeeded)?.restartRequired).toBe(true);
    expect(payloadRestartStatus(appData, "built", succeeded)?.restartRequired).toBe(false);
  });
});
