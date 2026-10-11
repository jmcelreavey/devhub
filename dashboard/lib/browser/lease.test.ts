import { describe, it, expect, vi, afterEach } from "vitest";
import { BrowserLease } from "./lease";
afterEach(() => vi.useRealTimers());
describe("managed browser control", () => {
  it("starts human, rejects replay after takeover, and rotates access", async () => {
    const lease = new BrowserLease();
    expect(() => lease.credential()).toThrow();
    const old = lease.grant();
    await expect(lease.execute(old, async () => "ok")).resolves.toBe("ok");
    await lease.takeover();
    expect(lease.mode).toBe("human");
    expect(() => lease.check(old)).toThrow();
    expect(lease.grant()).not.toBe(old);
    expect(() => lease.check(old)).toThrow();
  });
  it("revokes immediately and acknowledges only after an in-flight operation settles", async () => {
    const lease = new BrowserLease(); const token = lease.grant();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let subsequentAction = false;
    const run = lease.execute(token, async (check) => { await gate; check(); subsequentAction = true; });
    const rejected = expect(run).rejects.toThrow();
    await Promise.resolve();
    const takeover = lease.takeover();
    expect(lease.mode).toBe("taking-control");
    await expect(lease.execute(token, async () => "forbidden")).rejects.toThrow();
    release(); await takeover; await rejected;
    expect(subsequentAction).toBe(false); expect(lease.mode).toBe("human");
  });
  it("a newer takeover invalidates an in-progress resume", async () => {
    const lease = new BrowserLease(); lease.grant();
    const resumeRevision = await lease.takeover();
    await lease.takeover();
    expect(() => lease.grant(resumeRevision)).toThrow("control changed");
    expect(lease.mode).toBe("human");
  });
  it("does not queue competing commands", async () => {
    const lease = new BrowserLease(); const token = lease.grant();
    let release!: () => void;
    const run = lease.execute(token, () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    await expect(lease.execute(token, async () => undefined)).rejects.toThrow("still running");
    release(); await run;
  });
  it("expires credentials and refuses grants after stop", async () => {
    vi.useFakeTimers(); const lease = new BrowserLease(); const token = lease.grant();
    vi.advanceTimersByTime(15 * 60_000);
    expect(() => lease.check(token)).toThrow();
    await lease.stop(); expect(() => lease.grant()).toThrow();
  });
  it("cancels an operation before its first action when takeover wins the microtask", async () => {
    const lease = new BrowserLease(); const token = lease.grant(); const action = vi.fn();
    const run = lease.execute(token, async () => action());
    const rejected = expect(run).rejects.toThrow();
    await lease.takeover(); await rejected; expect(action).not.toHaveBeenCalled();
  });
});
