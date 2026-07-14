import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./aggregate";
import {
  buildEvidenceLinks,
  extractCitedPaths,
  labCategory,
  normalizeGitRemote,
  pickTargetRepo,
  preferredStarterLanguage,
  verifyCitedPaths,
} from "./journey";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { DetectedSignal, RepoScan } from "./types";

function sig(id: string, over: Partial<DetectedSignal> = {}): DetectedSignal {
  return {
    id,
    label: id === "terraform" ? "Terraform" : id,
    kind: "technology",
    area: "infra",
    evidence: [`${id}/f.yaml`],
    count: 1,
    confidence: 0.9,
    ...over,
  };
}

function repo(name: string, signals: DetectedSignal[], source: "local" | "github" = "local"): RepoScan {
  return {
    repoName: name,
    repoRef: source === "local" ? `/repos/${name}` : `github:acme/${name}`,
    source,
    sha: "abc",
    depth: source === "local" ? "full" : "tree",
    scannedAt: "2026-07-01T00:00:00.000Z",
    signals,
    lastTouchedByMe: {},
  };
}

describe("labCategory", () => {
  it("builds a labs/<repo>/<signal> path", () => {
    expect(labCategory("frigga", "flux")).toBe("labs/frigga/flux");
  });

  it("sanitises unsafe characters so labs stay inside the learnings dir", () => {
    expect(labCategory("../etc", "a/b")).toBe("labs/.._etc/a_b");
    expect(labCategory("my repo", "workload identity")).toBe("labs/my_repo/workload_identity");
  });
});

describe("pickTargetRepo", () => {
  it("prefers the local repo with the most evidence for the signal", () => {
    const snap = buildSnapshot(
      [
        repo("a", [sig("terraform", { evidence: ["a/one.tf"] })]),
        repo("b", [sig("terraform", { evidence: ["b/one.tf", "b/two.tf", "b/three.tf"] })]),
      ],
      "2026-07-01T00:00:00.000Z",
    );
    const picked = pickTargetRepo(snap, snap.signals["terraform"]);
    expect(picked?.repoName).toBe("b");
  });

  it("honours an explicit preferred repo when it has the signal", () => {
    const snap = buildSnapshot(
      [repo("a", [sig("terraform")]), repo("b", [sig("terraform")])],
      "2026-07-01T00:00:00.000Z",
    );
    expect(pickTargetRepo(snap, snap.signals["terraform"], "a")?.repoName).toBe("a");
  });

  it("skips remote-only repos (a lab must be grounded in a clone)", () => {
    const snap = buildSnapshot([repo("remote", [sig("terraform")], "github")], "2026-07-01T00:00:00.000Z");
    expect(pickTargetRepo(snap, snap.signals["terraform"])).toBeNull();
  });
});

describe("preferredStarterLanguage", () => {
  it("prefers TypeScript whenever the repo has any JS/TS footprint", () => {
    expect(preferredStarterLanguage(repo("a", [sig("typescript"), sig("python")]))).toBe("TypeScript (Node.js)");
    expect(preferredStarterLanguage(repo("a", [sig("node")]))).toBe("TypeScript (Node.js)");
  });

  it("uses the repo's own language for unambiguously non-Node repos", () => {
    expect(preferredStarterLanguage(repo("a", [sig("go")]))).toBe("Go");
    expect(preferredStarterLanguage(repo("a", [sig("python")]))).toBe("Python");
  });

  it("defaults to TypeScript for pure-infra repos with no runtime signal", () => {
    expect(preferredStarterLanguage(repo("a", [sig("terraform"), sig("datadog")]))).toBe("TypeScript (Node.js)");
  });
});

describe("normalizeGitRemote", () => {
  it("normalises scp-style, ssh, and https remotes to an https base", () => {
    expect(normalizeGitRemote("git@github.com:acme/repo.git")).toBe("https://github.com/acme/repo");
    expect(normalizeGitRemote("ssh://git@github.com/acme/repo.git")).toBe("https://github.com/acme/repo");
    expect(normalizeGitRemote("https://github.com/acme/repo.git")).toBe("https://github.com/acme/repo");
  });

  it("returns null for empty or non-url remotes", () => {
    expect(normalizeGitRemote(null)).toBeNull();
    expect(normalizeGitRemote("")).toBeNull();
  });
});

describe("buildEvidenceLinks", () => {
  it("builds blob URLs when the remote + sha are known", () => {
    const links = buildEvidenceLinks(["a/b.tf"], "https://github.com/acme/repo", "abc");
    expect(links[0]).toEqual({ path: "a/b.tf", url: "https://github.com/acme/repo/blob/abc/a/b.tf" });
  });

  it("leaves url null when the remote is unknown", () => {
    expect(buildEvidenceLinks(["a/b.tf"], null, "abc")[0].url).toBeNull();
  });
});

describe("extractCitedPaths", () => {
  it("pulls backticked path-like tokens and ignores prose and bare words", () => {
    const md = "Open `infra/main.tf` and `terraform/cluster.tf`, run `terraform plan`, see `README`.";
    const paths = extractCitedPaths(md);
    expect(paths).toContain("infra/main.tf");
    expect(paths).toContain("terraform/cluster.tf");
    expect(paths).not.toContain("terraform plan"); // has a space
    expect(paths).not.toContain("README"); // no slash
  });

  it("ignores URLs and git remotes (not repo file paths)", () => {
    const md = "See `ssh://git@github.com/acme/eks-config.git` and `git@github.com:acme/x.git` and `https://x.io/a/b`.";
    expect(extractCitedPaths(md)).toEqual([]);
  });
});

describe("verifyCitedPaths", () => {
  it("passes cited paths in the evidence set and flags unknown ones", () => {
    const md = "See `infra/main.tf` and `infra/ghost.tf`.";
    const unverified = verifyCitedPaths(md, ["infra/main.tf"], "/nonexistent-repo-root");
    expect(unverified).toEqual(["infra/ghost.tf"]);
  });

  it("passes a cited path that exists on disk even if not in the evidence set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-verify-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "real.tf"), "x");
    try {
      const md = "Open `sub/real.tf` and `sub/fake.tf`.";
      expect(verifyCitedPaths(md, [], dir)).toEqual(["sub/fake.tf"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
