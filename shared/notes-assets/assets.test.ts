import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  NOTES_ASSETS_API_PREFIX,
  assertNoteAssetRelPath,
  imageMarkdownLine,
  parseImageMarkdownLine,
  resolveNoteAssetUnderRoot,
  toNoteAssetApiUrl,
  toNoteAssetMarkdownPath,
} from "./index.ts";

describe("notes-assets paths", () => {
  it("builds API URLs from notes-relative paths", () => {
    expect(toNoteAssetApiUrl("garden/bed/assets/photo-1.jpg")).toBe(
      `${NOTES_ASSETS_API_PREFIX}garden/bed/assets/photo-1.jpg`,
    );
  });

  it("round-trips API URLs to markdown paths", () => {
    const api = `${NOTES_ASSETS_API_PREFIX}garden/foo%20bar/a.png`;
    expect(toNoteAssetMarkdownPath(api)).toBe("garden/foo bar/a.png");
  });

  it("rejects traversal and json paths", () => {
    expect(() => assertNoteAssetRelPath("../etc/passwd")).toThrow(/traversal/i);
    expect(() => assertNoteAssetRelPath("daily/note.json")).toThrow(/\.json/i);
    expect(() => assertNoteAssetRelPath("x.txt")).toThrow(/Unsupported/);
  });

  it("resolves assets under notes root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "notes-assets-"));
    const rel = "garden/p/assets/x.jpg";
    const abs = resolveNoteAssetUnderRoot(root, rel);
    expect(abs).toBe(path.join(root, "garden", "p", "assets", "x.jpg"));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parses image markdown lines", () => {
    expect(parseImageMarkdownLine("![Site](garden/a.jpg)")).toEqual({
      caption: "Site",
      path: "garden/a.jpg",
    });
    expect(parseImageMarkdownLine("not an image")).toBeNull();
  });

  it("formats image markdown lines", () => {
    expect(imageMarkdownLine("Site", "garden/a.jpg")).toBe("![Site](garden/a.jpg)");
  });
});
