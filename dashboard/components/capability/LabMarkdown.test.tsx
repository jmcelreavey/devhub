import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LabMarkdown } from "./LabMarkdown";

describe("LabMarkdown tables", () => {
  it("renders GFM pipe tables as real tables", () => {
    const md = [
      "| Variable | Purpose |",
      "| --- | --- |",
      "| `NOTES_DIR` | Notes directory |",
      "| `PORT` | Dashboard port |",
    ].join("\n");
    const html = renderToStaticMarkup(<LabMarkdown text={md} />);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("NOTES_DIR");
    // no raw pipe characters should survive
    expect(html).not.toContain("| ---");
  });

  it("handles alignment markers", () => {
    const md = "| A | B |\n| :--- | ---: |\n| 1 | 2 |";
    const html = renderToStaticMarkup(<LabMarkdown text={md} />);
    expect(html).toContain("text-align:left");
    expect(html).toContain("text-align:right");
  });

  it("leaves plain pipes alone when there is no delimiter row", () => {
    const html = renderToStaticMarkup(<LabMarkdown text={"a | b"} />);
    expect(html).not.toContain("<table");
  });
});
