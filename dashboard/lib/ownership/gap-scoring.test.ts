import { describe, expect, it } from "vitest";
import { domainContributions, familiarityScore, FAMILIARITY_CEILING, summarizeDefaultBranchRuns } from "./service";
import type { RepoDomain } from "./types";

const score = (churn: number, familiarity: number) => churn * (1 - familiarity);

function domain(id: string, paths = [id]): RepoDomain {
  return { id, label: id, paths, source: "directory", codeowners: [] };
}

describe("familiarity scoring", () => {
  it("never reaches 1, so a busy domain can never score zero", () => {
    // The original bug: familiarity was linear and capped at 1.0, so
    // `churn × (1 − familiarity)` went to exactly 0 and the domain vanished from
    // the ledger entirely.
    const saturated = familiarityScore(500, 500, "2026-01-01T00:00:00.000Z");
    expect(saturated).toBeLessThanOrEqual(FAMILIARITY_CEILING);
    expect(saturated).toBeLessThan(1);
    expect(score(133, saturated)).toBeGreaterThan(0);
  });

  it("keeps the busiest domain top of the ledger despite prior reviews", () => {
    // Real numbers from businessinsider/capi: `deployments` had 265 commits and
    // 6 of my reviews and scored 0, while a 2-commit dotfile directory ranked
    // third. The busiest domain must stay first.
    const deployments = score(133.02, familiarityScore(0, 6, null));
    const dotfiles = score(0.5, familiarityScore(0, 0, null));
    const terraform = score(9.38, familiarityScore(0, 0, null));
    expect(deployments).toBeGreaterThan(terraform);
    expect(terraform).toBeGreaterThan(dotfiles);
  });

  it("still rewards familiarity — a known domain ranks below an unknown one of equal churn", () => {
    const known = score(50, familiarityScore(30, 10, "2026-01-01T00:00:00.000Z"));
    const unknown = score(50, familiarityScore(0, 0, null));
    expect(known).toBeLessThan(unknown);
  });

  it("weights writing the code above reviewing it, and reviewing above reading it", () => {
    expect(familiarityScore(9, 0, null)).toBeGreaterThan(familiarityScore(0, 9, null));
    expect(familiarityScore(0, 9, null)).toBeGreaterThan(familiarityScore(0, 0, "2026-01-01T00:00:00.000Z"));
  });

  it("saturates rather than growing without bound", () => {
    const ten = familiarityScore(10, 0, null);
    const hundred = familiarityScore(100, 0, null);
    expect(hundred - ten).toBeLessThan(ten);
  });

  it("is zero with no evidence, and tolerates nonsense input", () => {
    expect(familiarityScore(0, 0, null)).toBe(0);
    expect(familiarityScore(-5, -5, null)).toBe(0);
  });
});

describe("domain contributions", () => {
  const domains = [domain("api", ["src/api"]), domain("web", ["src/web"])];

  it("counts one commit per domain, however many files it touched there", () => {
    const contributions = domainContributions(
      [{
        sha: "a",
        subject: "change",
        committedAt: "2026-08-01T00:00:00.000Z",
        email: "alice@acme.com",
        files: ["src/api/one.ts", "src/api/two.ts", "src/web/three.ts"],
      }],
      domains,
    );
    expect(contributions).toEqual([
      { author: "alice@acme.com", domainId: "api", commits: 1 },
      { author: "alice@acme.com", domainId: "web", commits: 1 },
    ]);
  });

  it("accumulates across commits and separates authors", () => {
    const commit = (email: string, file: string, sha: string) => ({
      sha,
      subject: "change",
      committedAt: "2026-08-01T00:00:00.000Z",
      email,
      files: [file],
    });
    const contributions = domainContributions(
      [
        commit("alice@acme.com", "src/api/one.ts", "a"),
        commit("alice@acme.com", "src/api/two.ts", "b"),
        commit("bob@acme.com", "src/web/three.ts", "c"),
      ],
      domains,
    );
    expect(contributions).toContainEqual({ author: "alice@acme.com", domainId: "api", commits: 2 });
    expect(contributions).toContainEqual({ author: "bob@acme.com", domainId: "web", commits: 1 });
  });

  it("skips commits with no author email and files outside every domain", () => {
    const contributions = domainContributions(
      [
        { sha: "a", subject: "x", committedAt: "", email: "", files: ["src/api/one.ts"] },
        { sha: "b", subject: "y", committedAt: "", email: "alice@acme.com", files: ["README.md"] },
      ],
      domains,
    );
    expect(contributions).toEqual([]);
  });
});

describe("default branch CI", () => {
  it("aggregates every workflow for the latest commit", () => {
    expect(summarizeDefaultBranchRuns([
      { headSha: "new", status: "completed", conclusion: "success" },
      { headSha: "new", status: "completed", conclusion: "failure" },
      { headSha: "old", status: "completed", conclusion: "success" },
    ])).toBe("failing");
  });

  it("reports pending before passing and ignores older commits", () => {
    expect(summarizeDefaultBranchRuns([
      { headSha: "new", status: "in_progress" },
      { headSha: "old", status: "completed", conclusion: "failure" },
    ])).toBe("pending");
  });
});
