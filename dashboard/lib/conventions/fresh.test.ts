import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConventionsFile } from "./types";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));
vi.mock("./local-repos", () => ({
  githubFullNameForLocalName: vi.fn((name: string) => (name === "widgets" ? "acme/widgets" : null)),
}));

const { ensureConventionsFresh, isThrottled, resolveGithubRepo } = await import("./fresh");
const { saveConventionsPrefs } = await import("./prefs");
const { updateConventions } = await import("./store");

const NOW = new Date("2026-10-06T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function stamp(repo: string, checkedAt: string, lastRunOk = true) {
  return updateConventions(repo, (file: ConventionsFile) => {
    file.checkedAt = checkedAt;
    file.runs.unshift({ at: checkedAt, trigger: "agent", ok: lastRunOk, prsScanned: 0, comments: 0, considered: 0, added: 0, reinforced: 0, ms: 1, guidanceFiles: [] });
  });
}

function deps(over: Record<string, unknown> = {}) {
  return {
    mine: vi.fn(async () => ({ status: "mined" as const, run: {} as never })),
    isGhAuthenticated: async () => true,
    resolveRepo: async (ref: string) => ref,
    now: () => NOW,
    ...over,
  } as never;
}

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conv-fresh-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("isThrottled", () => {
  const prefs = { minIntervalHours: 12 };
  const file = (checkedAt: string | undefined, lastOk = true): ConventionsFile => ({
    version: 1,
    repo: "a/b",
    rules: [],
    minedPrs: {},
    checkedAt,
    runs: checkedAt ? [{ at: checkedAt, trigger: "agent", ok: lastOk, prsScanned: 0, comments: 0, considered: 0, added: 0, reinforced: 0, ms: 1, guidanceFiles: [] }] : [],
  });

  it("never throttles a repo that has not been checked", () => {
    expect(isThrottled(null, prefs, NOW)).toBe(false);
    expect(isThrottled(file(undefined), prefs, NOW)).toBe(false);
  });

  it("holds inside the interval and releases after it", () => {
    expect(isThrottled(file(hoursAgo(11)), prefs, NOW)).toBe(true);
    expect(isThrottled(file(hoursAgo(13)), prefs, NOW)).toBe(false);
  });

  it("honours an in-memory check for a repo with no file, and the newer of the two wins", () => {
    expect(isThrottled(null, prefs, NOW, { at: hoursAgo(2), failed: false })).toBe(true);
    expect(isThrottled(null, prefs, NOW, { at: hoursAgo(13), failed: false })).toBe(false);
    // The file says "checked 20h ago", memory says "checked 1h ago": memory wins.
    expect(isThrottled(file(hoursAgo(20)), prefs, NOW, { at: hoursAgo(1), failed: false })).toBe(true);
    // A failed soft check backs off for an hour only.
    expect(isThrottled(null, prefs, NOW, { at: hoursAgo(2), failed: true })).toBe(false);
  });

  it("assesses legacy suggestions promptly but retains failure backoff", () => {
    const pending = file(hoursAgo(0.5));
    pending.rules.push({
      id: "r_old", text: "Keep handlers in separate files", category: "structure",
      status: "suggested", origin: "review", evidence: [], prs: [42],
      firstSeen: hoursAgo(24), lastSeen: hoursAgo(24),
    });
    expect(isThrottled(pending, prefs, NOW)).toBe(false);
    pending.runs[0].ok = false;
    expect(isThrottled(pending, prefs, NOW)).toBe(true);
    pending.checkedAt = hoursAgo(2);
    expect(isThrottled(pending, prefs, NOW)).toBe(false);
  });

  it("retries a failed run after an hour, not after the full interval", () => {
    expect(isThrottled(file(hoursAgo(0.5), false), prefs, NOW)).toBe(true);
    expect(isThrottled(file(hoursAgo(2), false), prefs, NOW)).toBe(false);
  });
});

describe("resolveGithubRepo", () => {
  it("passes owner/repo through and resolves a local folder name via its remote", async () => {
    expect(await resolveGithubRepo("acme/widgets")).toBe("acme/widgets");
    expect(await resolveGithubRepo("widgets")).toBe("acme/widgets");
    expect(await resolveGithubRepo("unknown")).toBeNull();
  });
});

describe("ensureConventionsFresh", () => {
  it("does nothing when the feature is off", async () => {
    await saveConventionsPrefs({ enabled: false });
    const d = deps();
    expect(await ensureConventionsFresh("acme/widgets", { trigger: "review", deps: d })).toEqual({ status: "disabled" });
    expect((d as { mine: ReturnType<typeof vi.fn> }).mine).not.toHaveBeenCalled();
  });

  it("reports a repo it cannot resolve", async () => {
    const result = await ensureConventionsFresh("nope", { trigger: "review", deps: deps({ resolveRepo: async () => null }) });
    expect(result.status).toBe("invalid-repo");
  });

  it("skips a repo mined inside the interval but not one past it", async () => {
    await stamp("acme/widgets", hoursAgo(2));
    expect((await ensureConventionsFresh("acme/widgets", { trigger: "review", deps: deps() })).status).toBe("throttled");

    await stamp("acme/widgets", hoursAgo(20));
    expect((await ensureConventionsFresh("acme/widgets", { trigger: "review", deps: deps() })).status).toBe("started");
  });

  it("needs GitHub to be authenticated", async () => {
    const d = deps({ isGhAuthenticated: async () => false });
    expect((await ensureConventionsFresh("acme/widgets", { trigger: "review", deps: d })).status).toBe("no-github");
  });

  it("starts a run and returns at once when not asked to wait", async () => {
    const mine = vi.fn(() => new Promise<never>(() => undefined));
    const result = await ensureConventionsFresh("acme/widgets", { trigger: "create-pr", deps: deps({ mine }) });
    expect(result).toEqual({ status: "started", repo: "acme/widgets" });
    expect(mine).toHaveBeenCalledWith("acme/widgets", { trigger: "create-pr" });
  });

  it("waits for the run when asked, and maps its outcome", async () => {
    const cases = [
      [{ status: "mined" }, "completed"],
      [{ status: "up-to-date" }, "up-to-date"],
      [{ status: "failed" }, "failed"],
    ] as const;
    for (const [outcome, expected] of cases) {
      const result = await ensureConventionsFresh("acme/widgets", { trigger: "review", waitMs: 1000, deps: deps({ mine: async () => outcome }) });
      expect(result.status).toBe(expected);
    }
  });

  it("gives up waiting but leaves the run going", async () => {
    const result = await ensureConventionsFresh("acme/widgets", { trigger: "review", waitMs: 20, deps: deps({ mine: () => new Promise(() => undefined) }) });
    expect(result.status).toBe("timeout");
  });

  it("turns a thrown run into a failed status rather than an unhandled rejection", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await ensureConventionsFresh("acme/widgets", {
      trigger: "review",
      waitMs: 1000,
      deps: deps({
        mine: async () => {
          throw new Error("disk full");
        },
      }),
    });
    expect(result.status).toBe("failed");
    spy.mockRestore();
  });
});
