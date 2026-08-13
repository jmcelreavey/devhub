/**
 * Behavioural evals for the vendored skills.
 *
 * ## What these cover that nothing else does
 *
 * `vendor-audit.test.ts` proves the scripts *can't* reach the network.
 * `provenance.test.ts` proves we know who owns them. Neither says whether they
 * still **work**. A re-vendor that quietly breaks rename-following in the
 * archaeologist, or drops the payments-wall cause from the graveyard, passes
 * every other check in this repo.
 *
 * These run each script against a synthetic repository built by
 * `scripts/skill-evals/build-fixture.py`, where every signal being asserted was
 * deliberately planted. That is the only way "does it find the revert" is
 * answerable — you have to have put a revert there.
 *
 * ## Why assertions are loose about ordering and exact counts
 *
 * These are third-party heuristics, not our invariants. Pinning
 * `co_changed[0].count === 4` would turn a harmless upstream tweak into a red
 * build and train everyone to skip the failure. Each test asserts the property
 * the skill *claims* — the companion file ranks as a co-change, the rename is
 * detected, the dependency is flagged — and leaves the tuning alone.
 *
 * ## Skipped rather than failed when python3 is missing
 *
 * The vendored skills are Python; DevHub is not. A contributor without python3
 * should get a clear skip, not a failure in a suite they can't act on.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VENDOR = path.join(REPO_ROOT, "skills", "vendor");
const BUILDER = path.join(REPO_ROOT, "scripts", "skill-evals", "build-fixture.py");

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PYTHON = hasPython();

function hasVendorSkills(): boolean {
  return fs.existsSync(path.join(VENDOR, "commit-archaeologist", "scripts", "archaeologist.py"));
}

const describeIfVendorEval = PYTHON && hasVendorSkills() ? describe : describe.skip;

interface Fixture {
  root: string;
  archaeology: {
    path: string;
    target_file: string;
    companion_file: string;
    unrelated_file: string;
    expected_signals: string[];
  };
  scope: {
    path: string;
    intent: string;
    in_scope: string[];
    expect_creep: string[];
    expect_new_dep: string;
    expect_rename: { from: string; to: string };
  };
  graveyard: { root: string; author_email: string };
}

let fixture: Fixture;
let fixtureDir: string;

/** Run a vendored script and parse its `--json` output. */
function runSkill(script: string, args: string[]): unknown {
  const out = execFileSync("python3", [path.join(VENDOR, script), ...args], {
    encoding: "utf-8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

beforeAll(() => {
  if (!PYTHON || !hasVendorSkills()) return;
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-skill-eval-"));
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  const out = execFileSync("python3", [BUILDER, fixtureDir], {
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  fixture = JSON.parse(out) as Fixture;
}, 180_000);

afterAll(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describeIfVendorEval("commit-archaeologist", () => {
  interface Report {
    introduced_by: { subject: string };
    timeline: Array<{ category: string; subject: string }>;
    co_changed: Array<{ file: string; count: number }>;
    authors: Array<{ email: string; current_lines: number; timeline_commits: number }>;
    intent_signals: Array<{ type: string }>;
  }

  let report: Report;
  beforeAll(() => {
    report = runSkill("commit-archaeologist/scripts/archaeologist.py", [
      fixture.archaeology.path,
      fixture.archaeology.target_file,
      "--json",
    ]) as Report;
  });

  it("identifies the introducing commit, not the most recent one", () => {
    expect(report.introduced_by.subject).toContain("add in-memory store");
  });

  it("finds every planted intent signal", () => {
    const found = new Set(report.intent_signals.map((s) => s.type));
    for (const expected of fixture.archaeology.expected_signals) {
      expect(found).toContain(expected);
    }
  });

  it("categorises the revert rather than burying it as a generic change", () => {
    expect(report.timeline.map((c) => c.category)).toContain("revert");
  });

  it("surfaces the companion file as a co-change", () => {
    const files = report.co_changed.map((c) => c.file);
    expect(files).toContain(fixture.archaeology.companion_file);
  });

  it("does not report a one-off file as a co-change", () => {
    // docs/notes.md was touched once. Treating that as coupling is the failure
    // mode the reference doc warns about.
    const files = report.co_changed.map((c) => c.file);
    expect(files).not.toContain(fixture.archaeology.unrelated_file);
  });

  it("keeps current blame separate from historical authorship", () => {
    // The second author's only commit was reverted, so they own zero surviving
    // lines but one timeline commit. Collapsing these into one "author" number
    // is exactly the false certainty the skill is supposed to avoid.
    const second = report.authors.find((a) => a.email === "second@example.invalid");
    expect(second).toBeDefined();
    expect(second!.current_lines).toBe(0);
    expect(second!.timeline_commits).toBeGreaterThan(0);
  });
});

describeIfVendorEval("scope-creep-detector", () => {
  interface Report {
    in_scope: Array<{ path: string }>;
    likely_creep: Array<{ path: string; signals: string[] }>;
    new_deps: Array<{ name: string }>;
    api_renames: Array<{ from: string; to: string }>;
    config_edits: Array<{ path: string; kind: string }>;
  }

  let report: Report;
  beforeAll(() => {
    report = runSkill("scope-creep-detector/scripts/scope_creep.py", [
      "--repo", fixture.scope.path,
      "--base", "main",
      "--intent", fixture.scope.intent,
      "--json",
    ]) as Report;
  });

  it("keeps the file the intent names in scope", () => {
    expect(report.in_scope.map((f) => f.path)).toEqual(fixture.scope.in_scope);
  });

  it("flags every file that overran the intent", () => {
    const creep = report.likely_creep.map((f) => f.path);
    for (const expected of fixture.scope.expect_creep) {
      expect(creep).toContain(expected);
    }
  });

  it("detects the added dependency", () => {
    expect(report.new_deps.map((d) => d.name)).toContain(fixture.scope.expect_new_dep);
  });

  it("detects the public API rename", () => {
    expect(report.api_renames).toContainEqual(
      expect.objectContaining(fixture.scope.expect_rename),
    );
  });

  it("classifies the workflow edit as CI rather than generic config", () => {
    const ci = report.config_edits.find((c) => c.path === ".github/workflows/ci.yml");
    expect(ci?.kind).toBe("ci");
  });

  it("attaches the reason to the file it belongs to", () => {
    // A report that flags four files and lists four signals globally is much
    // less useful than one that says which file carries which.
    const deps = report.likely_creep.find((f) => f.path === "requirements.txt");
    expect(deps?.signals).toContain("new_dependency");
  });
});

describeIfVendorEval("project-graveyard", () => {
  interface Report {
    /**
     * `causes` is a ranked list of `[code, humanExplanation]` pairs, not a
     * single verdict — the skill can find more than one wound and orders them
     * by confidence. Asserting on a scalar `cause` silently passed `undefined`
     * against the expected string until this was checked against real output.
     */
    dead: Array<{ name: string; causes: Array<[string, string]> }>;
    alive: unknown[];
    days_threshold: number;
  }

  let report: Report;
  beforeAll(() => {
    const jsonPath = path.join(fixtureDir, "graveyard.json");
    execFileSync(
      "python3",
      [
        path.join(VENDOR, "project-graveyard/scripts/graveyard.py"),
        fixture.graveyard.root,
        "--days", "45",
        "--me", fixture.graveyard.author_email,
        "--no-art",
        "--json", jsonPath,
      ],
      { encoding: "utf-8", timeout: 120_000, stdio: "ignore" },
    );
    report = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Report;
  });

  it("buries the abandoned repos and spares the active one", () => {
    const dead = report.dead.map((d) => d.name);
    expect(dead).toContain("tab-sensei");
    expect(dead).toContain("side-hustle");
    expect(dead).not.toContain("still-alive");
  });

  it("reads the payments wall from the final commits", () => {
    // The planted cause. Without this the scanner could report every corpse as
    // "unknown" and still pass a test that only counts the dead.
    const hustle = report.dead.find((d) => d.name === "side-hustle");
    expect(hustle).toBeDefined();
    expect(hustle!.causes.map(([code]) => code)).toContain("payments_wall");
  });

  it("respects ownership filtering by commit email", () => {
    // Every fixture repo is authored by the --me address, so nothing should be
    // skipped as foreign. This is the setting that silently dropped 10 of 12
    // real repos, so it is worth pinning.
    expect(report.dead.length + report.alive.length).toBe(4);
  });
});
