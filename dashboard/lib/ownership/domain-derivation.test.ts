import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDomains, domainForPath } from "./domains";

let repoRoot: string;

function write(relativePath: string, content = "x\n"): void {
  const target = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** `deriveDomains` reads the tracked file list, so the fixture has to be a real repo. */
function commitAll(): void {
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["-c", "user.email=t@t.co", "-c", "user.name=T", "commit", "-m", "fixture"], { cwd: repoRoot });
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-domains-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("derivation tiers", () => {
  it("prefers workspace packages when package.json declares them", async () => {
    write("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    write("packages/api/index.ts");
    write("packages/web/index.ts");
    write("packages/cli/index.ts");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    expect(domains.filter((domain) => domain.source === "workspace").map((domain) => domain.label))
      .toEqual(["packages/api", "packages/cli", "packages/web"]);
  });

  it("uses CODEOWNERS path prefixes when there is no workspace", async () => {
    write("CODEOWNERS", "* @acme/core\n/services/billing/ @acme/billing\n/services/search/ @acme/search\n");
    write("services/billing/index.ts");
    write("services/search/index.ts");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    const owned = domains.filter((domain) => domain.source === "codeowners");
    expect(owned.map((domain) => domain.label)).toEqual(["services/billing", "services/search"]);
    expect(owned[0]?.codeowners).toContain("@acme/billing");
  });

  it("falls back to top-level directories", async () => {
    write("src/index.ts");
    write("mongo/seed.js");
    write("test/e2e.ts");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    expect(domains.map((domain) => domain.label)).toContain("src");
    expect(domains.map((domain) => domain.label)).toContain("mongo");
  });

  it("keeps a root domain so files outside every directory still map somewhere", async () => {
    write("src/index.ts");
    write("mongo/seed.js");
    write("README.md");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    expect(domainForPath(domains, "README.md")?.label).toBe("Root");
    expect(domainForPath(domains, "src/index.ts")?.label).toBe("src");
  });
});

describe("tooling directories", () => {
  it("does not offer .github or .vscode as things to go and learn", async () => {
    // These churn constantly and crowded real code out of the gap ledger — on a
    // real repo `.agents` (2 commits) outranked domains with hundreds.
    write("src/index.ts");
    write("mongo/seed.js");
    write(".github/workflows/ci.yml");
    write(".vscode/settings.json");
    write(".agents/notes.md");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    const labels = domains.map((domain) => domain.label);
    expect(labels).not.toContain(".github");
    expect(labels).not.toContain(".vscode");
    expect(labels).not.toContain(".agents");
    expect(labels).toContain("src");
  });

  it("still routes tooling files somewhere rather than dropping them", async () => {
    write("src/index.ts");
    write("mongo/seed.js");
    write(".github/workflows/ci.yml");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    expect(domainForPath(domains, ".github/workflows/ci.yml")?.label).toBe("Root");
  });

  it("keeps a tooling path when CODEOWNERS names it explicitly", async () => {
    write("CODEOWNERS", "/.github/ @acme/infra\n/services/billing/ @acme/billing\n");
    write(".github/workflows/ci.yml");
    write("services/billing/index.ts");
    commitAll();

    const domains = await deriveDomains(repoRoot);
    expect(domains.map((domain) => domain.label)).toContain(".github");
  });
});

describe("overrides", () => {
  it("wins over derivation, and still resolves longest-prefix first", async () => {
    write("src/api/index.ts");
    commitAll();

    const domains = await deriveDomains(repoRoot, [
      { id: "everything", label: "Everything", paths: ["."] },
      { id: "api", label: "API", paths: ["src/api"] },
    ]);
    expect(domains.every((domain) => domain.source === "override")).toBe(true);
    // Order in the override list must not decide the match — a broad domain
    // listed first would otherwise shadow every specific one.
    expect(domainForPath(domains, "src/api/index.ts")?.id).toBe("api");
    expect(domainForPath(domains, "README.md")?.id).toBe("everything");
  });

  it("samples tracked files so overrides retain CODEOWNERS", async () => {
    write("CODEOWNERS", "/src/api/** @acme/api\n");
    write("src/api/index.ts");
    commitAll();

    const [domain] = await deriveDomains(repoRoot, [{ id: "api", label: "API", paths: ["src/api"] }]);
    expect(domain?.codeowners).toEqual(["@acme/api"]);
  });
});

describe("failure modes", () => {
  it("returns nothing rather than throwing outside a git repo", async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plain-"));
    try {
      expect(await deriveDomains(notARepo)).toEqual([]);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("degrades to a single root domain in an empty repository", async () => {
    const domains = await deriveDomains(repoRoot);
    expect(domains.map((domain) => domain.label)).toEqual(["Root"]);
  });
});
