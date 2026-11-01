import { describe, expect, it } from "vitest";
import {
  NOTE_SIZE,
  geoHeight,
  indexKeyAt,
  measureLabel,
  noteGrowY,
  noteHeight,
  wrapLine,
} from "./diagram-geometry.ts";

describe("wrapLine", () => {
  it("keeps a short line intact", () => {
    expect(wrapLine("S3 CV bucket", 22, 167)).toEqual(["S3 CV bucket"]);
  });

  it("wraps at the available width", () => {
    const rows = wrapLine("browser PUT via presigned URL to the dev bucket", 22, 167);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join(" ")).toBe("browser PUT via presigned URL to the dev bucket");
  });

  it("breaks a single word that cannot fit", () => {
    const rows = wrapLine("dev-job-search-agent-cv-use1.s3.us-east-1.amazonaws.com", 22, 167);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join("")).toBe("dev-job-search-agent-cv-use1.s3.us-east-1.amazonaws.com");
  });

  it("preserves an empty line", () => {
    expect(wrapLine("", 22, 167)).toEqual([""]);
  });
});

describe("measureLabel", () => {
  it("grows with line count", () => {
    const one = measureLabel("one", { maxWidth: NOTE_SIZE });
    const three = measureLabel("one\ntwo\nthree", { maxWidth: NOTE_SIZE });
    expect(three.height).toBeGreaterThan(one.height);
    expect(three.lines).toBe(3);
  });

  it("scales with font size", () => {
    const small = measureLabel("some text", { size: "s", maxWidth: NOTE_SIZE });
    const large = measureLabel("some text", { size: "xl", maxWidth: NOTE_SIZE });
    expect(large.height).toBeGreaterThan(small.height);
  });
});

describe("noteGrowY", () => {
  it("is zero for text that fits the box", () => {
    expect(noteGrowY("S3 CV bucket")).toBe(0);
  });

  it("grows for the notes that were overlapping", () => {
    // Verbatim from the diagram that rendered on top of itself.
    const text = [
      "Browser PUT via presigned URL",
      "PDF or DOCX source",
      "CORS must allow page origin",
      "ObjectCreated notification",
      "CV deleted after parse",
    ].join("\n");
    const grow = noteGrowY(text);
    expect(grow).toBeGreaterThan(0);
    expect(noteHeight(text)).toBe(NOTE_SIZE + grow);
  });

  it("returns whole pixels so repeated writes are stable", () => {
    const text = "a longer note\nwith several lines\nof content to wrap around";
    expect(noteGrowY(text)).toBe(Math.trunc(noteGrowY(text)));
  });
});

describe("indexKeyAt", () => {
  it("starts at tldraw's zero index", () => {
    expect(indexKeyAt(0)).toBe("a0");
    expect(indexKeyAt(1)).toBe("a1");
  });

  it("uses all 62 digits before widening", () => {
    expect(indexKeyAt(61)).toBe("az");
    expect(indexKeyAt(62)).toBe("b00");
    expect(indexKeyAt(63)).toBe("b01");
  });

  it("never emits the 'a10' shape that tldraw rejects", () => {
    const keys = Array.from({ length: 500 }, (_, i) => indexKeyAt(i));
    expect(keys).not.toContain("a10");
    // Head letter dictates the digit count: 'a' + 1, 'b' + 2, 'c' + 3.
    for (const key of keys) {
      const width = key.charCodeAt(0) - "a".charCodeAt(0) + 1;
      expect(key.length - 1).toBe(width);
    }
  });

  it("increases monotonically in sort order", () => {
    const keys = Array.from({ length: 200 }, (_, i) => indexKeyAt(i));
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("geoHeight", () => {
  it("keeps a one-line label compact", () => {
    expect(geoHeight("API", 260)).toBeLessThan(80);
  });

  it("honours the minimum height", () => {
    expect(geoHeight("API", 260, "m", 120)).toBe(120);
  });

  it("expands for long labels", () => {
    const tall = geoHeight("one\ntwo\nthree\nfour\nfive\nsix", 260);
    expect(tall).toBeGreaterThan(60);
  });

  it("is taller in a narrower box", () => {
    const text = "Acme BFF authenticates the member and forwards the bearer token";
    expect(geoHeight(text, 160)).toBeGreaterThan(geoHeight(text, 400));
  });
});
