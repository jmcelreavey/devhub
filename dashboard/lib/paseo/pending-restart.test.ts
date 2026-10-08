import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/exec-external", () => ({ execExternal: vi.fn() }));
vi.mock("./client", () => ({ paseoWebOrigin: () => "http://127.0.0.1:6767" }));
vi.mock("./update", () => ({ hasActivePaseoWork: vi.fn() }));
import { applyPendingPaseoRestart, clearPaseoRestartPending, paseoRestartPending, pendingRestartMarker, type PendingRestartDeps } from "./pending-restart";

function deps(over: Partial<PendingRestartDeps> = {}): PendingRestartDeps {
  return {
    pending: () => true,
    running: async () => true,
    hasActiveWork: async () => false,
    tryRestart: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    ...over,
  };
}

describe("applyPendingPaseoRestart", () => {
  it("does nothing without a marker", async () => {
    const d = deps({ pending: () => false });
    expect(await applyPendingPaseoRestart(d)).toBe("none");
    expect(d.tryRestart).not.toHaveBeenCalled();
  });
  it("try-restarts and clears the marker when Paseo is idle", async () => {
    const d = deps();
    expect(await applyPendingPaseoRestart(d)).toBe("restarted");
    expect(d.tryRestart).toHaveBeenCalledOnce();
    expect(d.clear).toHaveBeenCalledOnce();
  });
  it("leaves the marker for the Connection tab while a chat is running", async () => {
    const d = deps({ hasActiveWork: async () => true });
    expect(await applyPendingPaseoRestart(d)).toBe("deferred");
    expect(d.tryRestart).not.toHaveBeenCalled();
    expect(d.clear).not.toHaveBeenCalled();
  });
  it("treats unverifiable activity as busy", async () => {
    const d = deps({ hasActiveWork: async () => { throw new Error("cannot list agents"); } });
    expect(await applyPendingPaseoRestart(d)).toBe("deferred");
    expect(d.tryRestart).not.toHaveBeenCalled();
  });
  it("keeps the marker when the restart fails", async () => {
    const d = deps({ tryRestart: vi.fn().mockRejectedValue(new Error("systemctl failed")) });
    expect(await applyPendingPaseoRestart(d)).toBe("deferred");
    expect(d.clear).not.toHaveBeenCalled();
  });
  it("waits for a daemon that is still starting", async () => {
    const d = deps({ running: async () => false });
    expect(await applyPendingPaseoRestart(d)).toBe("waiting-for-daemon");
    expect(d.tryRestart).not.toHaveBeenCalled();
  });
});

describe("restart marker", () => {
  let appData: string;
  beforeEach(() => { appData = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-pending-")); });
  afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));
  it("is read from and cleared in the app-data paseo folder", () => {
    expect(paseoRestartPending(appData)).toBe(false);
    fs.mkdirSync(path.dirname(pendingRestartMarker(appData)), { recursive: true });
    fs.writeFileSync(pendingRestartMarker(appData), "");
    expect(paseoRestartPending(appData)).toBe(true);
    clearPaseoRestartPending(appData);
    expect(paseoRestartPending(appData)).toBe(false);
  });
});
