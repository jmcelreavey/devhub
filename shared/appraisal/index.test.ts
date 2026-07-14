import { describe, it, expect } from "vitest";
import { blocksToText, textToBlocks } from "../markdown-convert/index.ts";
import {
  slugify,
  subjectYearPath,
  skeleton,
  upsertEntry,
  upsertGoal,
  parseEntries,
  parseGoals,
  goalSlugs,
  deleteEntry,
  summaryWarning,
  THEME_LABELS,
} from "./index.ts";

/** Mimic the storage round-trip (blocks ↔ markdown) so tests catch any drift. */
const roundTrip = (md: string) => blocksToText(textToBlocks(md));

describe("slugify", () => {
  it("normalises titles to stable slugs", () => {
    expect(slugify("Cut CI pipeline time 22→9 min")).toBe("cut-ci-pipeline-time-229-min");
    expect(slugify("  Mentor two engineers!  ")).toBe("mentor-two-engineers");
    expect(slugify("")).toBe("untitled");
  });
});

describe("subjectYearPath", () => {
  it("routes self and people to distinct files", () => {
    expect(subjectYearPath(undefined, "2026")).toBe("appraisal/self/2026");
    expect(subjectYearPath("self", "2026")).toBe("appraisal/self/2026");
    expect(subjectYearPath("Jane Doe", "2026")).toBe("appraisal/people/jane-doe/2026");
  });
});

describe("entries", () => {
  it("inserts under the right theme and dedups on the same slug", () => {
    let md = skeleton("self", "2026");
    md = upsertEntry(md, {
      title: "Cut CI time",
      theme: "impact",
      summary: "Parallelised shards.",
      references: ["[PR #1](https://x/1)"],
    }).md;

    let entries = parseEntries(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].theme).toBe("impact");
    expect(entries[0].slug).toBe("cut-ci-time");

    // Same slug → update in place, still one entry, new body.
    const r = upsertEntry(md, {
      title: "Cut CI time",
      theme: "impact",
      summary: "Parallelised shards across 4 runners; 60% faster.",
      references: ["[PR #1](https://x/1)", "[dash](https://d)"],
    });
    expect(r.created).toBe(false);
    entries = parseEntries(r.md);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toContain("60% faster");
  });

  it("moves an entry when its theme changes, not duplicates", () => {
    let md = skeleton("self", "2026");
    md = upsertEntry(md, { title: "Refactor auth", theme: "technical", summary: "x.", references: ["ref"] }).md;
    md = upsertEntry(md, { title: "Refactor auth", theme: "growth", summary: "x.", references: ["ref"] }).md;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].theme).toBe("growth");
  });

  it("captures goal link and tags", () => {
    let md = skeleton("self", "2026");
    md = upsertEntry(md, {
      title: "Shipped GA",
      theme: "impact",
      summary: "Done.",
      references: ["ref"],
      goal: "ship-ga",
      tags: ["leadership", "#delivery"],
    }).md;
    const e = parseEntries(md)[0];
    expect(e.goal).toBe("ship-ga");
    expect(e.tags).toEqual(["#leadership", "#delivery"]);
  });

  it("survives the blocks↔markdown round-trip unchanged", () => {
    let md = skeleton("self", "2026");
    md = upsertGoal(md, { title: "Ship GA", detail: "GA with <1% errors." }).md;
    md = upsertEntry(md, {
      title: "Cut CI time",
      theme: "impact",
      summary: "Parallelised shards.",
      references: ["[PR #1](https://x/1)"],
      goal: "ship-ga",
      tags: ["ci"],
    }).md;

    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once); // stable
    expect(once).toContain("<!-- id: cut-ci-time -->");
    expect(once).toContain("<!-- goal: ship-ga -->");
    // Parsing still works after a storage cycle.
    expect(parseEntries(once)).toHaveLength(1);
    expect(parseGoals(once)).toHaveLength(1);
  });

  it("deletes an entry by slug", () => {
    let md = skeleton("self", "2026");
    md = upsertEntry(md, { title: "Temp", theme: "impact", summary: "x.", references: ["r"] }).md;
    const del = deleteEntry(md, "temp");
    expect(del.deleted).toBe(true);
    expect(parseEntries(del.md)).toHaveLength(0);
  });
});

describe("goals", () => {
  it("creates then revises, preserving set date and history", () => {
    let md = skeleton("self", "2026");
    const created = upsertGoal(md, { title: "Ship the matching pipeline", detail: "GA." });
    expect(created.created).toBe(true);
    md = created.md;
    const setDate = parseGoals(md)[0].set;

    const revised = upsertGoal(md, {
      title: "Ship the matching pipeline",
      status: "revised",
      revision: "Scoped to EU first.",
    });
    expect(revised.created).toBe(false);
    const g = parseGoals(revised.md)[0];
    expect(g.status).toBe("revised");
    expect(g.set).toBe(setDate); // set date preserved
    expect(g.revisions).toHaveLength(1);
    expect(g.revisions[0]).toContain("Scoped to EU first.");
  });

  it("exposes goal slugs for record validation", () => {
    let md = skeleton("self", "2026");
    md = upsertGoal(md, { title: "Mentor two to mid" }).md;
    expect(goalSlugs(md)).toEqual(["mentor-two-to-mid"]);
  });
});

describe("summaryWarning", () => {
  it("flags long summaries only", () => {
    expect(summaryWarning("Short and factual.")).toBeNull();
    expect(summaryWarning("One. Two. Three. Four sentences here.")).not.toBeNull();
  });
});

describe("skeleton", () => {
  it("has goals plus four themes", () => {
    const md = skeleton("self", "2026");
    expect(md).toContain("## Goals");
    for (const label of Object.values(THEME_LABELS)) expect(md).toContain(`## ${label}`);
  });
});
