import { describe, expect, it } from "vitest";
import { insertUnderHeading } from "./one-on-one-template";

describe("insertUnderHeading", () => {
  it("replaces a placeholder dash under Wins", () => {
    const md = `# 1:1\n\n## Wins / shipped\n-\n\n## Follow-ups\n- [ ]\n`;
    const out = insertUnderHeading(md, "Wins / shipped", "- [pr] Foo — bar (https://x)");
    expect(out).toContain("## Wins / shipped\n- [pr] Foo — bar (https://x)");
    expect(out).toContain("## Follow-ups\n- [ ]");
  });

  it("appends when section already has content", () => {
    const md = `## Follow-ups\n- existing\n\n## Other\n`;
    const out = insertUnderHeading(md, "Follow-ups", "- new item");
    expect(out).toBe(`## Follow-ups\n- existing\n- new item\n\n## Other\n`);
  });

  it("creates a missing section at the end", () => {
    const out = insertUnderHeading("# Hi", "Wins / shipped", "- x");
    expect(out).toContain("## Wins / shipped\n- x");
  });
});
