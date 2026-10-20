import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NOTE_MEDIA_MAX_BYTES,
  isNoteMediaName,
  noteMediaDir,
  noteMediaMime,
  readNoteMedia,
  sniffNoteMediaExt,
  storeNoteMedia,
} from "./media-store";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpg-body")]);
const GIF = Buffer.from("GIF89a-body");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-media-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sniffNoteMediaExt", () => {
  it("identifies raster formats by magic bytes", () => {
    expect(sniffNoteMediaExt(PNG)).toBe("png");
    expect(sniffNoteMediaExt(JPG)).toBe("jpg");
    expect(sniffNoteMediaExt(GIF)).toBe("gif");
    expect(sniffNoteMediaExt(WEBP)).toBe("webp");
  });

  it("rejects SVG, HTML and unknown bytes", () => {
    expect(sniffNoteMediaExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffNoteMediaExt(Buffer.from("<html><script>1</script>"))).toBeNull();
    expect(sniffNoteMediaExt(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffNoteMediaExt(Buffer.alloc(0))).toBeNull();
  });
});

describe("storeNoteMedia", () => {
  it("stores by sha256 and returns a stable api url", () => {
    const stored = storeNoteMedia(PNG, dir);
    expect(stored.name).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(stored.url).toBe(`/api/notes-media/${stored.name}`);
    expect(stored.mime).toBe("image/png");
    expect(stored.created).toBe(true);
    expect(readNoteMedia(stored.name, dir)?.equals(PNG)).toBe(true);
  });

  it("dedupes identical bytes", () => {
    const a = storeNoteMedia(JPG, dir);
    const b = storeNoteMedia(Buffer.from(JPG), dir);
    expect(b.name).toBe(a.name);
    expect(b.created).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([a.name]);
  });

  it("derives the extension from the bytes, not the caller", () => {
    expect(storeNoteMedia(WEBP, dir).name.endsWith(".webp")).toBe(true);
  });

  it("rejects empty, oversized and non-raster input without writing", () => {
    expect(() => storeNoteMedia(Buffer.alloc(0), dir)).toThrow(/empty/i);
    expect(() => storeNoteMedia(Buffer.concat([PNG, Buffer.alloc(NOTE_MEDIA_MAX_BYTES)]), dir)).toThrow(
      /too big/i,
    );
    expect(() => storeNoteMedia(Buffer.from("<svg/>"), dir)).toThrow(/PNG, JPEG/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("leaves no tmp files behind", () => {
    storeNoteMedia(GIF, dir);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("name validation", () => {
  const good = `${"a".repeat(64)}.png`;

  it("accepts only <sha256>.<raster ext>", () => {
    expect(isNoteMediaName(good)).toBe(true);
    expect(noteMediaMime(good)).toBe("image/png");
    expect(noteMediaMime(`${"b".repeat(64)}.jpg`)).toBe("image/jpeg");
    for (const bad of [
      "../etc/passwd",
      `../${good}`,
      `${"a".repeat(63)}.png`,
      `${"A".repeat(64)}.png`,
      `${"a".repeat(64)}.svg`,
      `${"a".repeat(64)}.png/../x`,
      `${good}\0`,
      "",
    ]) {
      expect(isNoteMediaName(bad), bad).toBe(false);
      expect(readNoteMedia(bad, dir), bad).toBeNull();
    }
  });

  it("returns null for a missing blob", () => {
    expect(readNoteMedia(good, dir)).toBeNull();
  });
});

describe("noteMediaDir", () => {
  it("lives in the profile state dir, outside the notes vault", () => {
    expect(noteMediaDir({ HOME: "/home/x" })).toBe("/home/x/.local/state/devhub/note-media");
  });

  it("honours DEVHUB_NOTE_MEDIA_DIR", () => {
    expect(noteMediaDir({ DEVHUB_NOTE_MEDIA_DIR: "/tmp/m" })).toBe("/tmp/m");
  });
});
