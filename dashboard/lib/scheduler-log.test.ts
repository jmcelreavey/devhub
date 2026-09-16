import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/devhub-scheduler-log-test-${process.pid}`);
vi.mock("@/lib/notes/dir", () => ({ getHome: () => home }));

import { appendSchedulerLog, schedulerLogFile, tailLines } from "./scheduler-log";

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("appendSchedulerLog", () => {
  it("writes timestamped, levelled lines under ~/.local/state/devhub and echoes to the console", () => {
    appendSchedulerLog("info", "scheduler", 'running "Validate" (abcd1234)', new Date("2026-09-14T18:19:00Z"));
    appendSchedulerLog("warn", "scheduler", "dispatch refused: budget", new Date("2026-09-14T18:20:00Z"));

    expect(schedulerLogFile()).toBe(path.join(home, ".local/state/devhub/scheduler.log"));
    expect(fs.readFileSync(schedulerLogFile(), "utf8")).toBe(
      '2026-09-14T18:19:00.000Z INFO  [scheduler] running "Validate" (abcd1234)\n' +
        "2026-09-14T18:20:00.000Z WARN  [scheduler] dispatch refused: budget\n",
    );
    expect(console.info).toHaveBeenCalledWith('[scheduler] running "Validate" (abcd1234)');
    expect(console.warn).toHaveBeenCalledWith("[scheduler] dispatch refused: budget");
  });

  it("rotates past 1 MB instead of growing forever", () => {
    fs.mkdirSync(path.dirname(schedulerLogFile()), { recursive: true });
    fs.writeFileSync(schedulerLogFile(), "x".repeat(1_000_001));
    appendSchedulerLog("info", "scheduler", "fresh");
    expect(fs.statSync(`${schedulerLogFile()}.1`).size).toBe(1_000_001);
    expect(fs.readFileSync(schedulerLogFile(), "utf8")).toContain("[scheduler] fresh");
  });
});

describe("tailLines", () => {
  it("returns the newest lines, filtered by a job id prefix", () => {
    for (let i = 0; i < 5; i++) appendSchedulerLog("info", "scheduler", `run ${i} for "A" (aaaa1111)`);
    appendSchedulerLog("info", "scheduler", 'run for "B" (bbbb2222)');

    expect(tailLines(schedulerLogFile(), 2)).toHaveLength(2);
    expect(tailLines(schedulerLogFile(), 2)[1]).toContain("bbbb2222");
    const onlyA = tailLines(schedulerLogFile(), 100, "aaaa1111");
    expect(onlyA).toHaveLength(5);
    expect(onlyA.at(-1)).toContain("run 4");
  });

  it("treats a missing file as empty", () => {
    expect(tailLines(path.join(home, "nope.log"), 10)).toEqual([]);
  });
});
