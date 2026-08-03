import { describe, expect, it } from "vitest";
import {
  firstHeadingFromBlocks,
  firstHeadingFromMarkdown,
  titleFromDocMarkdown,
  truncateMachineFilename,
  vaultDisplayTitle,
} from "./display-title";

describe("firstHeadingFromMarkdown", () => {
  it("picks the first heading", () => {
    expect(firstHeadingFromMarkdown("intro\n# Real Title\n## Sub")).toBe("Real Title");
  });

  it("returns undefined when none", () => {
    expect(firstHeadingFromMarkdown("just prose")).toBeUndefined();
  });
});

describe("firstHeadingFromBlocks", () => {
  it("reads a heading block", () => {
    expect(
      firstHeadingFromBlocks([
        {
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "PTF-4484 Address BI Jobs Feedback", styles: {} }],
          children: [],
        },
      ]),
    ).toBe("PTF-4484 Address BI Jobs Feedback");
  });
});

describe("titleFromDocMarkdown", () => {
  it("prefers frontmatter title", () => {
    expect(
      titleFromDocMarkdown("---\ntitle: From FM\n---\n# Body Heading\n"),
    ).toBe("From FM");
  });

  it("falls back to first heading", () => {
    expect(titleFromDocMarkdown("# Body Heading\n")).toBe("Body Heading");
  });
});

describe("truncateMachineFilename", () => {
  it("shortens date+uuid task note names", () => {
    expect(
      truncateMachineFilename("2026-07-31-cdc243c8-3352-488a-8d0f-deb465e8a5d5"),
    ).toBe("2026-07-31-cdc243c8…");
  });

  it("leaves short human names alone", () => {
    expect(truncateMachineFilename("standup-notes")).toBe("standup-notes");
  });
});

describe("vaultDisplayTitle", () => {
  it("prefers content title", () => {
    const result = vaultDisplayTitle(
      "2026-07-31-cdc243c8-3352-488a-8d0f-deb465e8a5d5",
      "PTF-4484 Address BI Jobs Feedback",
    );
    expect(result.displayTitle).toBe("PTF-4484 Address BI Jobs Feedback");
    expect(result.fromContent).toBe(true);
  });

  it("truncates machine filenames when no content title", () => {
    const result = vaultDisplayTitle(
      "2026-07-31-cdc243c8-3352-488a-8d0f-deb465e8a5d5",
      null,
    );
    expect(result.displayTitle).toBe("2026-07-31-cdc243c8…");
    expect(result.fromContent).toBe(false);
  });
});
