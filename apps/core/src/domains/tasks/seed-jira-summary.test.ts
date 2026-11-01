import { describe, expect, it } from "vitest";
import { summaryFromJiraDescription } from "./seed-jira-summary";

describe("summaryFromJiraDescription", () => {
  it("keeps a short description as written and has nothing for an empty one", () => {
    expect(summaryFromJiraDescription("Add an expand button.\n\nIt should go fullscreen.")).toBe("Add an expand button.\n\nIt should go fullscreen.");
    expect(summaryFromJiraDescription("  \n ")).toBeNull();
    expect(summaryFromJiraDescription(null)).toBeNull();
  });

  it("trims a long one at a sentence end, with an ellipsis", () => {
    const long = `${"Sentence one is here. ".repeat(60)}`;
    const result = summaryFromJiraDescription(long)!;
    expect(result.length).toBeLessThanOrEqual(702);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toMatch(/here\.…$/);
  });
});
