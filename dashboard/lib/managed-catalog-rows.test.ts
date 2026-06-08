import { describe, expect, it } from "vitest";
import {
  buildManagedCatalogRows,
  canAddToCatalog,
  canDeleteRow,
  countManagedRowsBySkillSource,
  filterManagedRowsBySkillSource,
  participatesInSync,
} from "./managed-catalog-rows";
import type { SkillListItem } from "./skills-api-types";
import type { LocalSkillImportCandidate } from "./local-skills-types";

function skill(name: string, source: SkillListItem["source"] = "devhub"): SkillListItem {
  return { name, description: null, source, readOnly: source === "ai-tools" };
}

function localCandidate(
  name: string,
  status: LocalSkillImportCandidate["status"],
  alreadyInRepo = false,
): LocalSkillImportCandidate {
  return {
    name,
    kind: "skill",
    sources: [{ tool: "codex", absPath: `/tmp/${name}`, kind: "skill", latestMtimeMs: 100 }],
    alreadyInRepo,
    status,
    repoMtimeMs: alreadyInRepo ? 50 : null,
    localMtimeMs: 100,
    excludedFromAutoCollect: false,
  };
}

describe("buildManagedCatalogRows", () => {
  it("adds local-only rows not in catalog", () => {
    const rows = buildManagedCatalogRows([skill("alpha")], [localCandidate("beta", "new")]);
    expect(rows.map((r) => r.name)).toEqual(["beta", "alpha"]);
    expect(rows[0].kind).toBe("local-only");
    expect(canAddToCatalog(rows[0])).toBe(true);
  });

  it("merges importable local onto catalog row without duplicate", () => {
    const rows = buildManagedCatalogRows(
      [skill("alpha")],
      [localCandidate("alpha", "local-newer", true)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("catalog");
    if (rows[0].kind === "catalog") {
      expect(rows[0].localCandidate?.status).toBe("local-newer");
      expect(canAddToCatalog(rows[0])).toBe(true);
    }
  });

  it("omits non-importable local when not in catalog", () => {
    const rows = buildManagedCatalogRows([], [localCandidate("synced", "in-sync", true)]);
    expect(rows).toHaveLength(0);
  });

  it("allows sync exclude toggle on local-only rows", () => {
    const rows = buildManagedCatalogRows([], [localCandidate("orphan", "new")]);
    expect(rows[0].kind).toBe("local-only");
    expect(participatesInSync(rows[0])).toBe(true);
  });

  it("keeps ai-tools catalog row without local overlay when in sync", () => {
    const rows = buildManagedCatalogRows(
      [skill("bi-foo", "ai-tools")],
      [localCandidate("bi-foo", "in-sync", false)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("catalog");
    if (rows[0].kind === "catalog") {
      expect(rows[0].localCandidate).toBeUndefined();
      expect(participatesInSync(rows[0])).toBe(true);
    }
  });
});

describe("canDeleteRow", () => {
  it("allows devhub catalog and local-only, blocks ai-tools", () => {
    const rows = buildManagedCatalogRows(
      [skill("shared", "devhub"), skill("bi-up", "ai-tools")],
      [localCandidate("local-only", "new")],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(canDeleteRow(byName.shared)).toBe(true);
    expect(canDeleteRow(byName["bi-up"])).toBe(false);
    expect(canDeleteRow(byName["local-only"])).toBe(true);
  });
});

describe("filterManagedRowsBySkillSource", () => {
  const rows = buildManagedCatalogRows(
    [skill("a", "devhub"), skill("b", "ai-tools")],
    [localCandidate("c", "new")],
  );

  it("filters local rows", () => {
    const local = filterManagedRowsBySkillSource(rows, "local");
    expect(local.map((r) => r.name)).toEqual(["c"]);
  });

  it("counts include local bucket", () => {
    const counts = countManagedRowsBySkillSource(rows);
    expect(counts.local).toBe(1);
    expect(counts.devhub).toBe(1);
    expect(counts["ai-tools"]).toBe(1);
  });
});
