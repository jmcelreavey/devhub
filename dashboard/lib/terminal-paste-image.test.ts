import { describe, expect, it } from "vitest";
import {
  collectTerminalPasteImageFiles,
  formatTerminalImagePathInject,
  isTerminalPasteImageFile,
} from "./terminal-paste-image";
import { extForPasteImageMime, normalizePasteImageMime } from "./terminal-paste-image-fs";

describe("formatTerminalImagePathInject", () => {
  it("joins paths with spaces and a trailing space", () => {
    expect(formatTerminalImagePathInject(["/tmp/a.png", "/tmp/b.jpg"])).toBe(
      "/tmp/a.png /tmp/b.jpg ",
    );
  });

  it("single-quotes paths that contain whitespace", () => {
    expect(formatTerminalImagePathInject(["/tmp/my shot.png"])).toBe("'/tmp/my shot.png' ");
  });

  it("returns empty for blank input", () => {
    expect(formatTerminalImagePathInject([])).toBe("");
    expect(formatTerminalImagePathInject(["  ", ""])).toBe("");
  });
});

describe("isTerminalPasteImageFile", () => {
  it("accepts image mime and known extensions", () => {
    expect(isTerminalPasteImageFile(new File([""], "a.png", { type: "image/png" }))).toBe(true);
    expect(isTerminalPasteImageFile(new File([""], "a.jpg", { type: "" }))).toBe(true);
    expect(isTerminalPasteImageFile(new File([""], "notes.txt", { type: "text/plain" }))).toBe(
      false,
    );
  });
});

describe("collectTerminalPasteImageFiles", () => {
  it("reads image items from DataTransfer-like objects", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const dt = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => png,
        },
        {
          kind: "string",
          type: "text/plain",
          getAsFile: () => null,
        },
      ],
      files: [] as unknown as FileList,
    } as unknown as DataTransfer;

    expect(collectTerminalPasteImageFiles(dt)).toEqual([png]);
  });

  it("falls back to files when items are empty", () => {
    const jpg = new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" });
    const txt = new File(["hi"], "x.txt", { type: "text/plain" });
    const dt = {
      items: [] as unknown as DataTransferItemList,
      files: [jpg, txt] as unknown as FileList,
    } as unknown as DataTransfer;

    expect(collectTerminalPasteImageFiles(dt)).toEqual([jpg]);
  });
});

describe("normalizePasteImageMime / extForPasteImageMime", () => {
  it("maps mime to extension", () => {
    expect(extForPasteImageMime("image/jpeg")).toBe("jpg");
    expect(extForPasteImageMime("image/png")).toBe("png");
    expect(normalizePasteImageMime("image/webp")).toBe("image/webp");
    expect(normalizePasteImageMime("application/octet-stream", "shot.png")).toBe("image/png");
    expect(normalizePasteImageMime("application/octet-stream", "shot.bin")).toBeNull();
  });
});
