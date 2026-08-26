import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GeneratedRep } from "./reps";

let tmpRepo: string;
let originalRepoRoot: string | undefined;
let originalRepsDir: string | undefined;

async function freshRepModule() {
  const url = new URL("./reps.ts", import.meta.url).href + `?t=${Date.now()}`;
  return (await import(url)) as typeof import("./reps");
}

function coldRead(sha = "abc1234def"): GeneratedRep {
  return {
    kind: "cold-read",
    material: {
      kind: "cold-read",
      repo: "example-org/example-service",
      sha,
      committedAt: "2026-08-20T10:00:00Z",
      filesChanged: 3,
      additions: 40,
      deletions: 12,
    },
    reveal: {
      kind: "cold-read",
      subject: "fix: close the connection pool on shutdown",
      body: "Leaked sockets under SIGTERM.",
      author: "Colleague",
      url: `https://github.com/example-org/example-service/commit/${sha}`,
    },
  };
}

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
  it("start is idempotent — the day's rep sticks", async () => {
    const m = await freshRepModule();
    await m.startRep("2026-08-21", coldRead("first00"));
    const second = await m.startRep("2026-08-21", coldRead("second0"));
    expect(second.material.kind).toBe("cold-read");
    expect((second.material as { sha: string }).sha).toBe("first00");
    expect(second.attempt).toBe(0);
  });

  it("save requires a started rep and stamps completion", async () => {
    const m = await freshRepModule();
    await expect(m.saveRepResponse("2026-08-21", "- x")).rejects.toThrow();
    await m.startRep("2026-08-21", coldRead());
    const rep = await m.saveRepResponse("2026-08-21", "- refactors pool shutdown");
    expect(rep.completedAt).toBeTruthy();
    expect(rep.response).toBe("- refactors pool shutdown");
  });

  it("swap replaces material and bumps attempt, refuses after completion", async () => {
    const m = await freshRepModule();
    await expect(m.swapRep("2026-08-21", coldRead())).rejects.toThrow(); // nothing started
    await m.startRep("2026-08-21", coldRead("first00"));
    const swapped = await m.swapRep("2026-08-21", coldRead("second0"));
    expect((swapped.material as { sha: string }).sha).toBe("second0");
    expect(swapped.attempt).toBe(1);
    expect(swapped.response).toBeUndefined();
    await m.saveRepResponse("2026-08-21", "- done");
    await expect(m.swapRep("2026-08-21", coldRead("third00"))).rejects.toThrow();
  });

  it("toPublicRep withholds the reveal until completion", async () => {
    const m = await freshRepModule();
    const started = await m.startRep("2026-08-21", coldRead());
    expect(m.toPublicRep(started)?.reveal).toBeUndefined();
    const completed = await m.saveRepResponse("2026-08-21", "- answer");
    expect(m.toPublicRep(completed)?.reveal?.kind).toBe("cold-read");
    expect(m.toPublicRep(null)).toBeNull();
  });

  it("streak counts consecutive completed days and ignores gaps", async () => {
    const m = await freshRepModule();
    for (const date of ["2026-08-19", "2026-08-20"]) {
      await m.startRep(date, coldRead());
      await m.saveRepResponse(date, "- finding");
    }
    // Gap on the 18th must not matter.
    await m.startRep("2026-08-17", coldRead());
    await m.saveRepResponse("2026-08-17", "- old");

    let stats = m.repStats("2026-08-20");
    expect(stats.streak).toBe(2);
    expect(stats.completedCount).toBe(3);

    await m.startRep("2026-08-21", coldRead());
    stats = m.repStats("2026-08-21");
    expect(stats.streak).toBe(2); // started but not completed
    await m.saveRepResponse("2026-08-21", "- today");
    stats = m.repStats("2026-08-21");
    expect(stats.streak).toBe(3);
  });

  it("repStats returns a 35-day recent strip ending today", async () => {
    const m = await freshRepModule();
    await m.startRep("2026-08-20", coldRead());
    await m.saveRepResponse("2026-08-20", "- x");
    const stats = m.repStats("2026-08-21");
    expect(stats.recent).toHaveLength(35);
    expect(stats.recent[0].date).toBe("2026-07-18");
    expect(stats.recent[34]).toEqual({ date: "2026-08-21", done: false });
    expect(stats.recent.find((d) => d.date === "2026-08-20")).toEqual({ date: "2026-08-20", done: true });
  });

  it("readRep rejects malformed dates, missing files, and pre-refactor rep shapes", async () => {
    const m = await freshRepModule();
    expect(m.readRep("not-a-date")).toBeNull();
    expect(m.readRep("2026-08-21")).toBeNull();
    // A legacy PR-review rep has no kind/material — must be ignored, not crash.
    fs.mkdirSync(path.join(tmpRepo, "reps"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRepo, "reps", "2026-08-15.json"),
      JSON.stringify({ date: "2026-08-15", pr: { repo: "a/b", number: 1 }, completedAt: "x" }),
    );
    expect(m.readRep("2026-08-15")).toBeNull();
  });

  it("repTeaser names the material", async () => {
    const m = await freshRepModule();
    expect(m.repTeaser(coldRead("abc1234def"))).toBe("Cold read: example-service @ abc1234");
    expect(
      m.repTeaser({
        material: {
          kind: "gap-sketch",
          repo: "example-org/example-service",
          domainId: "ingest",
          label: "Ingest pipeline",
          paths: ["src/ingest"],
          commits90d: 42,
          authoredByMe: 0,
        },
      }),
    ).toBe("Gap sketch: Ingest pipeline in example-service");
    expect(
      m.repTeaser({ material: { kind: "recall", title: "demo-caching", diagramPath: "diagrams/Acme/demo-caching" } }),
    ).toBe("Recall: demo-caching");
  });
});
