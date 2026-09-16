import { describe, expect, it } from "vitest";
import { adfToPlainText } from "./implement-ready-gather";

describe("adfToPlainText", () => {
  it("flattens ADF paragraphs", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ship the " },
            { type: "text", text: "ready gate" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Warn, don't block." }],
        },
      ],
    };
    expect(adfToPlainText(adf)).toContain("Ship the ready gate");
    expect(adfToPlainText(adf)).toContain("Warn, don't block.");
  });

  it("handles plain strings and empty input", () => {
    expect(adfToPlainText("hello")).toBe("hello");
    expect(adfToPlainText(null)).toBe("");
  });
});
