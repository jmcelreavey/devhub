import { describe, expect, it } from "vitest";
import {
  buildNotePasteAssetRelPath,
  extForNotePasteImage,
  isNotePasteImageFile,
  sanitizePasteBasename,
} from "./paste-image";

describe("buildNotePasteAssetRelPath", () => {
  it("places assets under the per-note wrapper folder", () => {
    expect(
      buildNotePasteAssetRelPath("garden/fence-repair-repaint", {
        ext: "png",
        now: 1_725_000_000_123,
      }),
    ).toBe("garden/fence-repair-repaint/assets/paste-1725000000123.png");
  });

  it("strips .json and drops traversal segments", () => {
    expect(
      buildNotePasteAssetRelPath("task-notes/../evil/note.json", {
        ext: "jpg",
        name: "Shot One.png",
        now: 1000,
      }),
    ).toBe("task-notes/evil/note/assets/shot-one-1000.jpg");
  });

  it("requires a note path", () => {
    expect(() => buildNotePasteAssetRelPath("", { ext: "png" })).toThrow(/required/i);
    expect(() => buildNotePasteAssetRelPath("..", { ext: "png" })).toThrow(/required/i);
  });
});

describe("sanitizePasteBasename / ext helpers", () => {
  it("drops generic clipboard names", () => {
    expect(sanitizePasteBasename("image.png")).toBeNull();
    expect(sanitizePasteBasename("paste.webp")).toBeNull();
    expect(sanitizePasteBasename("My Screenshot 1.png")).toBe("my-screenshot-1");
  });

  it("maps mime and filename to extensions", () => {
    expect(extForNotePasteImage("image/jpeg")).toBe("jpg");
    expect(extForNotePasteImage("", "shot.WEBP")).toBe("webp");
  });

  it("accepts only raster image files", () => {
    expect(isNotePasteImageFile(new File([new Uint8Array([1])], "a.png", { type: "image/png" }))).toBe(
      true,
    );
    expect(isNotePasteImageFile(new File(["hi"], "a.txt", { type: "text/plain" }))).toBe(false);
  });
});
