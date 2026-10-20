import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitWithParent } from "./exit-with-parent.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(ppid = { value: 4242 }) {
  const stdin = new PassThrough();
  const exit = vi.fn();
  const cleanup = exitWithParent({ stdin, exit, getPpid: () => ppid.value, pollMs: 1_000, log: () => undefined });
  return { stdin, exit, ppid, cleanup };
}

describe("exitWithParent", () => {
  it("exits when stdin ends", () => {
    const { stdin, exit } = setup();
    stdin.emit("end");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits when stdin closes", () => {
    const { stdin, exit } = setup();
    stdin.emit("close");
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits when the parent is gone (re-parented to launchd)", () => {
    const { exit, ppid } = setup();
    vi.advanceTimersByTime(3_000);
    expect(exit).not.toHaveBeenCalled();
    ppid.value = 1;
    vi.advanceTimersByTime(1_000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits only once", () => {
    const { stdin, exit, ppid } = setup();
    stdin.emit("end");
    ppid.value = 1;
    stdin.emit("close");
    vi.advanceTimersByTime(5_000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("does not consume stdin data", () => {
    const { stdin, exit } = setup();
    const seen: string[] = [];
    stdin.on("data", (chunk: Buffer) => seen.push(chunk.toString()));
    stdin.write("hello");
    expect(seen).toEqual(["hello"]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("can watch only the parent", () => {
    const stdin = new PassThrough();
    const exit = vi.fn();
    const ppid = { value: 7 };
    exitWithParent({ stdin, exit, getPpid: () => ppid.value, pollMs: 1_000, watchStdin: false, log: () => undefined });
    stdin.emit("end");
    expect(exit).not.toHaveBeenCalled();
    ppid.value = 1;
    vi.advanceTimersByTime(1_000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("stops watching after cleanup", () => {
    const { stdin, exit, ppid, cleanup } = setup();
    cleanup();
    stdin.emit("end");
    ppid.value = 1;
    vi.advanceTimersByTime(5_000);
    expect(exit).not.toHaveBeenCalled();
  });
});
