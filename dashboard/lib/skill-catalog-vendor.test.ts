/**
 * Precedence and read-only rules for skills/vendor.
 *
 * The interesting cases are the collisions. A vendored skill must beat ai-tools
 * and plugins but lose to skills/shared, because shadowing with a core skill is
 * the only supported way to change vendored behaviour — editing files under
 * skills/vendor gets overwritten on the next re-vendor.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SkillCatalogEntry } from "./skill-catalog";
import {
  buildMergedSkillCatalog,
  catalogOriginCounts,
  listSkillsFromCatalog,
  resolveCatalogSkillName,
  upstreamOnlySkillNames,
  vendorCatalogEntries,
} from "./skill-catalog";
import { validateVendorProvenance } from "./skills/provenance";

let repoRoot: string;

/**
 * Drop plugin-contributed entries before asserting.
 *
 * `repoRoot` is a temp dir, but plugins are resolved from the *real*
 * `~/.config/devhub/plugins.json`, so the catalog is only isolated on a machine
 * with no plugins registered. These tests originally asserted on whole-catalog
 * length and passed everywhere except a machine that had plugins installed —
 * which is to say, they passed everywhere except in real use.
 */
function ownEntries(catalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return catalog.filter((e) => e.origin === "devhub" || e.origin === "vendor");
}

function writeSkill(parent: string, name: string, body: string) {
  const dir = path.join(repoRoot, "skills", parent, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
}

const vendored = (name: string) => `---
name: ${name}
description: A vendored skill.
license: Apache-2.0
metadata:
  author: "Upstream Author"
  version: "1.0.0"
  source: "https://github.com/example/upstream"
---
`;

const core = (name: string) => `---
name: ${name}
description: A DevHub skill.
---
`;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-vendor-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("vendor skills in the merged catalog", () => {
  it("includes vendored skills and marks them read-only", () => {
    writeSkill("vendor", "scope-creep-detector", vendored("scope-creep-detector"));
    writeSkill("shared", "rubber-duck", core("rubber-duck"));

    const catalog = buildMergedSkillCatalog(repoRoot);
    const byName = Object.fromEntries(catalog.map((e) => [e.name, e]));

    expect(byName["scope-creep-detector"].origin).toBe("vendor");
    expect(byName["rubber-duck"].origin).toBe("devhub");
    const counts = catalogOriginCounts(catalog);
    expect(counts.devhub).toBe(1);
    expect(counts.vendor).toBe(1);

    const list = listSkillsFromCatalog(catalog);
    const vendorItem = list.find((s) => s.name === "scope-creep-detector")!;
    expect(vendorItem.readOnly).toBe(true);
    expect(vendorItem.license).toBe("Apache-2.0");
    expect(vendorItem.sourceUrl).toBe("https://github.com/example/upstream");
  });

  it("lets a core skill shadow a vendored skill of the same name", () => {
    writeSkill("vendor", "scope-creep-detector", vendored("scope-creep-detector"));
    writeSkill("shared", "scope-creep-detector", core("scope-creep-detector"));

    const catalog = buildMergedSkillCatalog(repoRoot);
    const matching = catalog.filter((e) => e.name === "scope-creep-detector");

    expect(matching).toHaveLength(1);
    expect(matching[0].origin).toBe("devhub");
    expect(matching[0].overridesUpstream).toBe(true);
  });

  it("does not attach licence metadata to core skills", () => {
    // Reading provenance for skills/shared would be 22 file reads per page load
    // to rediscover that the repo is MIT.
    writeSkill("shared", "rubber-duck", core("rubber-duck"));
    const list = listSkillsFromCatalog(ownEntries(buildMergedSkillCatalog(repoRoot)));
    expect(list[0].license).toBeNull();
  });

  it("treats vendored skills as externally owned so collect never copies them back", () => {
    writeSkill("vendor", "commit-archaeologist", vendored("commit-archaeologist"));
    expect(upstreamOnlySkillNames(repoRoot).has("commit-archaeologist")).toBe(true);
  });

  it("stops treating a vendored name as external once core claims it", () => {
    writeSkill("vendor", "commit-archaeologist", vendored("commit-archaeologist"));
    writeSkill("shared", "commit-archaeologist", core("commit-archaeologist"));
    expect(upstreamOnlySkillNames(repoRoot).has("commit-archaeologist")).toBe(false);
  });

  it("ignores a vendor directory that does not exist", () => {
    writeSkill("shared", "rubber-duck", core("rubber-duck"));
    expect(catalogOriginCounts(buildMergedSkillCatalog(repoRoot)).vendor).toBe(0);
  });

  it("skips vendor entries without a SKILL.md", () => {
    fs.mkdirSync(path.join(repoRoot, "skills", "vendor", "not-a-skill"), { recursive: true });
    expect(ownEntries(buildMergedSkillCatalog(repoRoot))).toEqual([]);
  });
});

describe("vendor provenance validation", () => {
  it("passes when every vendored skill declares its provenance", () => {
    writeSkill("vendor", "scope-creep-detector", vendored("scope-creep-detector"));
    const entries = vendorCatalogEntries(buildMergedSkillCatalog(repoRoot));
    expect(validateVendorProvenance(entries)).toEqual([]);
  });

  it("names the missing fields when provenance is incomplete", () => {
    writeSkill("vendor", "sloppy", "---\nname: sloppy\ndescription: No licence.\n---\n");
    const entries = vendorCatalogEntries(buildMergedSkillCatalog(repoRoot));
    expect(validateVendorProvenance(entries)).toEqual([
      { skill: "sloppy", missing: ["license", "author", "version", "source"] },
    ]);
  });

  it("does not demand provenance from core skills", () => {
    writeSkill("shared", "rubber-duck", core("rubber-duck"));
    const entries = vendorCatalogEntries(buildMergedSkillCatalog(repoRoot));
    expect(entries).toEqual([]);
    expect(validateVendorProvenance(entries)).toEqual([]);
  });
});

describe("root-level third-party skills", () => {
  it("includes skills/<name> in the catalog as read-only vendor origin", () => {
    writeSkill("shared", "rubber-duck", core("rubber-duck"));
    const rootDir = path.join(repoRoot, "skills", "frontend-design");
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, "SKILL.md"), core("frontend-design"));

    const catalog = buildMergedSkillCatalog(repoRoot);
    const byName = Object.fromEntries(catalog.map((e) => [e.name, e]));
    expect(byName["frontend-design"].origin).toBe("vendor");
    expect(path.basename(path.dirname(byName["frontend-design"].dir))).toBe("skills");

    const list = listSkillsFromCatalog(catalog);
    expect(list.find((s) => s.name === "frontend-design")?.readOnly).toBe(true);
    expect(vendorCatalogEntries(catalog).map((e) => e.name)).not.toContain("frontend-design");
    expect(upstreamOnlySkillNames(repoRoot).has("frontend-design")).toBe(true);
  });
});

describe("resolveCatalogSkillName", () => {
  it("matches unprefixed local names to devhub- prefixed catalog names", () => {
    const names = new Set(["devhub-repo-ownership", "rubber-duck"]);
    expect(resolveCatalogSkillName("repo-ownership", names)).toBe("devhub-repo-ownership");
    expect(resolveCatalogSkillName("devhub-repo-ownership", names)).toBe("devhub-repo-ownership");
    expect(resolveCatalogSkillName("rubber-duck", names)).toBe("rubber-duck");
    expect(resolveCatalogSkillName("missing", names)).toBeNull();
  });
});
