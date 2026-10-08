import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The idle and ceiling timers of execCapture, driven by fake timers against a
 * scripted child. The real-process versions of these checks raced the machine:
 * a 150ms gap or a 300ms idle budget is shorter than a scheduling stall on a
 * busy CI box, so the CLI was killed (or kept) for reasons unrelated to the
 * logic under test. Here the clock only moves when the test moves it.
 */
class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  out(text: string) { this.stdout.emit("data", Buffer.from(text)); }
  exit(code = 0) { this.emit("close", code); }
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:child_process")>()), spawn: spawnMock }));

import { execCapture } from "./cli-runner";

let child: FakeChild;
let kill: ReturnType<typeof vi.spyOn>;

/** Start a capture and let it reach spawn (the limiter hops a microtask first). */
async function start(timeoutMs: number, idleMs: number) {
  const run = execCapture("fake-cli", [], timeoutMs, "/tmp", undefined, idleMs);
  // Attach the handler now so a rejection during timer advance isn't "unhandled".
  const settled = run.then((value) => ({ value }), (error: Error) => ({ error }));
  await vi.advanceTimersByTimeAsync(0);
  expect(spawnMock).toHaveBeenCalledTimes(1);
  return settled;
}

beforeEach(() => {
  vi.useFakeTimers();
  child = new FakeChild();
  spawnMock.mockReset().mockReturnValue(child);
  kill = vi.spyOn(process, "kill").mockImplementation(() => true);
});
afterEach(() => {
  kill.mockRestore();
  vi.useRealTimers();
});

describe("execCapture idle timer", () => {
  it("keeps waiting while output is still arriving", async () => {
    // Chunks 150ms apart under a 400ms idle budget: the run outlasts the
    // budget, but no single gap does, so it must not be killed.
    const result = start(5_000, 400);
    await vi.advanceTimersByTimeAsync(0);
    child.out("a");
    await vi.advanceTimersByTimeAsync(150);
    child.out("b");
    await vi.advanceTimersByTimeAsync(150);
    child.out("c");
    await vi.advanceTimersByTimeAsync(150);
    expect(kill).not.toHaveBeenCalled();
    child.exit(0);
    await expect(result).resolves.toEqual({ value: "abc" });
  });

  it("gives up once the CLI goes quiet, and says how far it got", async () => {
    const result = start(10_000, 300);
    await vi.advanceTimersByTimeAsync(0);
    child.out("partial");
    await vi.advanceTimersByTimeAsync(299);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    const outcome = await result;
    expect((outcome as { error: Error }).error.message).toMatch(/went quiet .* 7 bytes/);
  });

  it("keeps a finished document even when the CLI then hangs", async () => {
    // The regression that lost work: output was complete, the process lingered,
    // and the old total-time kill discarded the whole buffer.
    const result = start(10_000, 300);
    await vi.advanceTimersByTimeAsync(0);
    child.out("<html><body>ok</body></html>");
    await vi.advanceTimersByTimeAsync(300);
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    const outcome = await result;
    expect((outcome as { value: string }).value).toContain("</html>");
  });

  it("does not start the idle timer until the first byte (silent while thinking)", async () => {
    // Silent far past the idle budget, then answers. The idle timer must not
    // run before output begins, or a buffering CLI is killed while working.
    const result = start(5_000, 150);
    await vi.advanceTimersByTimeAsync(400);
    expect(kill).not.toHaveBeenCalled();
    child.out("late");
    child.exit(0);
    await expect(result).resolves.toEqual({ value: "late" });
  });

  it("falls back to the hard ceiling when the CLI never speaks", async () => {
    const result = start(1_000, 150);
    await vi.advanceTimersByTimeAsync(999);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    const outcome = await result;
    expect((outcome as { error: Error }).error.message).toMatch(/1s time limit while still working \(0 bytes/);
  });
});
