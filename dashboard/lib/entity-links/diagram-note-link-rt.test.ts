import { describe, expect, it } from "vitest";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import {
  parseEntityLinksFromMarkdown,
  upsertEntityLinksInMarkdown,
  mergeEntityRefs,
  defaultHrefForRef,
  type EntityRef,
} from "@shared/entity-note";
import { buildEntityRefFromInput } from "./build-ref";

describe("notes diagram link end-to-end", () => {
  it("build → upsert → textToBlocks → blocksToText → parse keeps diagram", () => {
    const ref = buildEntityRefFromInput(
      "diagram",
      "diagrams/Acme/Widget/Legal architecture overview",
    );
    const base = "# Job Search Agent\n\nBody text.\n";
    const withLinks = upsertEntityLinksInMarkdown(base, [ref]);
    expect(withLinks).toContain("**Diagram:**");
    expect(withLinks).toContain("/diagrams/Acme/Widget/");

    const blocks = textToBlocks(withLinks);
    const back = blocksToText(blocks as unknown[]);
    const parsed = parseEntityLinksFromMarkdown(back);
    expect(parsed.some((r: EntityRef) => r.kind === "diagram")).toBe(true);
    const d = parsed.find((r: EntityRef) => r.kind === "diagram");
    expect(d).toBeDefined();
    expect(defaultHrefForRef(d!)).toMatch(/\/diagrams\//);
  });

  it("merge with existing links via VaultEditor onSave shape", () => {
    const md = "# Hello\n\n## Links\n\n**Jira:** [PTF-1](https://example/browse/PTF-1)\n";
    const ref = buildEntityRefFromInput("diagram", "diagrams/Acme/overview");
    const next = upsertEntityLinksInMarkdown(
      md,
      mergeEntityRefs(parseEntityLinksFromMarkdown(md), [ref]),
    );
    const blocks = textToBlocks(next);
    const back = blocksToText(blocks as unknown[]);
    const parsed = parseEntityLinksFromMarkdown(back);
    expect(parsed.map((r: EntityRef) => r.kind).sort()).toEqual(["diagram", "jira"]);
  });
});
