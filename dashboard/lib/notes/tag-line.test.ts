import { describe, expect, it } from "vitest";
import { parseTagLine } from "./tag-line";

describe("parseTagLine", () => {
  it("reads the label and each tag with offsets", () => {
    const line = parseTagLine("Tags: #alpha #beta-two");
    expect(line?.label).toEqual({ start: 0, end: 5 });
    expect(line?.tags).toEqual([
      { tag: "alpha", start: 6, end: 12 },
      { tag: "beta-two", start: 13, end: 22 },
    ]);
  });

  it("is case-insensitive on the label, lowercases tags and allows commas", () => {
    const line = parseTagLine("  tags:  #Alpha, #beta");
    expect(line?.tags.map((t) => t.tag)).toEqual(["alpha", "beta"]);
    expect(line?.label).toEqual({ start: 2, end: 7 });
  });

  it("rejects lines with prose, numbers or bare words after the label", () => {
    expect(parseTagLine("Tags: #alpha and more")).toBeNull();
    expect(parseTagLine("Tags: #525")).toBeNull();
    expect(parseTagLine("Tags: #alpha#beta")).toBeNull();
    expect(parseTagLine("Tags: alpha")).toBeNull();
    expect(parseTagLine("Tags:")).toBeNull();
    expect(parseTagLine("My Tags: #alpha")).toBeNull();
    expect(parseTagLine("Tagsmith: #alpha")).toBeNull();
  });

  it("does not match a tag over 32 chars", () => {
    expect(parseTagLine(`Tags: #${"a".repeat(33)}`)).toBeNull();
    expect(parseTagLine(`Tags: #${"a".repeat(32)}`)?.tags).toHaveLength(1);
  });
});
