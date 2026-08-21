import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRepo: string;
let originalRepoRoot: string | undefined;
let originalRepsDir: string | undefined;

async function freshRepModule() {
  const url = new URL("./reps.ts", import.meta.url).href + `?t=${Date.now()}`;
  return (await import(url)) as typeof import("./reps");
}

const PR = {
  repo: "example-org/example-service",
  number: 123,
  title: "Example change",
  url: "https://github.com/example-org/example-service/pull/123",
};

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-reps-"));
  originalRepoRoot = process.env.REPO_ROOT;
  originalRepsDir = process.env.REPS_DIR;
  process.env.REPO_ROOT = tmpRepo;
  process.env.REPS_DIR = path.join(tmpRepo, "reps");
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
  if (originalRepsDir === undefined) delete process.env.REPS_DIR;
  else process.env.REPS_DIR = originalRepsDir;
});

describe("reps", () => {
  it("start is idempotent — the day's pick sticks", async () => {
    const m = await freshRepModule();
    await m.startRep("2026-08-21", PR);
    const second = await m.startRep("2026-08-21", { ...PR, number: 456 });
    expect(second.pr?.number).toBe(123);
  });

  it("save requires a started rep; grade requires saved findings", async () => {
    const m = await freshRepModule();
    await expect(m.saveRepFindings("2026-08-21", "- x")).rejects.toThrow();
    await m.startRep("2026-08-21", PR);
    await expect(m.gradeRep("2026-08-21", { caught: 1, missed: 1 })).rejects.toThrow();
    const rep = await m.saveRepFindings("2026-08-21", "- null check missing");
    expect(rep.completedAt).toBeTruthy();
    const graded = await m.gradeRep("2026-08-21", { caught: 2, missed: 1 });
    expect(graded.grade).toEqual({ caught: 2, missed: 1 });
  });

  it("streak counts consecutive completed days, survives an ungraded today, ignores gaps", async () => {
    const m = await freshRepModule();
    // Two completed days ending yesterday.
    for (const date of ["2026-08-19", "2026-08-20"]) {
      await m.startRep(date, PR);
      await m.saveRepFindings(date, "- finding");
    }
    // Gap on the 18th must not matter; grade one day for totals.
    await m.startRep("2026-08-17", PR);
    await m.saveRepFindings("2026-08-17", "- old");
    await m.gradeRep("2026-08-17", { caught: 3, missed: 2 });

    let stats = m.repStats("2026-08-20");
    expect(stats.streak).toBe(2);
    expect(stats.completedCount).toBe(3);
    expect(stats.gradedCount).toBe(1);
    expect(stats.caughtTotal).toBe(3);
    expect(stats.missedTotal).toBe(2);

    // Completing today extends the streak to 3.
    await m.startRep("2026-08-21", PR);
    stats = m.repStats("2026-08-21");
    expect(stats.streak).toBe(2); // started but not completed
    await m.saveRepFindings("2026-08-21", "- today");
    stats = m.repStats("2026-08-21");
    expect(stats.streak).toBe(3);
  });

  it("repick swaps before completion, refuses after", async () => {
    const m = await freshRepModule();
    await expect(m.repickRep("2026-08-21", PR)).rejects.toThrow(); // nothing started
    await m.startRep("2026-08-21", PR);
    const swapped = await m.repickRep("2026-08-21", { ...PR, number: 456 });
    expect(swapped.pr?.number).toBe(456);
    await m.saveRepFindings("2026-08-21", "- done");
    await expect(m.repickRep("2026-08-21", { ...PR, number: 789 })).rejects.toThrow();
  });

  it("repStats returns a 35-day recent strip ending today", async () => {
    const m = await freshRepModule();
    await m.startRep("2026-08-20", PR);
    await m.saveRepFindings("2026-08-20", "- x");
    await m.gradeRep("2026-08-20", { caught: 2, missed: 5 });
    const stats = m.repStats("2026-08-21");
    expect(stats.recent).toHaveLength(35);
    expect(stats.recent[0].date).toBe("2026-07-18");
    expect(stats.recent[34]).toEqual({ date: "2026-08-21", done: false });
    const the20th = stats.recent.find((d) => d.date === "2026-08-20");
    expect(the20th).toEqual({ date: "2026-08-20", done: true, caught: 2, missed: 5 });
  });

  it("readRep rejects malformed dates and missing files", async () => {
    const m = await freshRepModule();
    expect(m.readRep("not-a-date")).toBeNull();
    expect(m.readRep("2026-08-21")).toBeNull();
  });
});
