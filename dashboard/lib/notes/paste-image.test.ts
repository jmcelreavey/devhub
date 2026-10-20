import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTES_PASTE_IMAGE_MAX_BYTES,
  extForNotePasteImage,
  isNotePasteImageFile,
  uploadNotePasteImage,
  validateNotePasteImage,
} from "./paste-image";

const png = (bytes = 1, name = "a.png") =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });

describe("ext / type helpers", () => {
  it("maps mime and filename to extensions", () => {
    expect(extForNotePasteImage("image/jpeg")).toBe("jpg");
    expect(extForNotePasteImage("", "shot.WEBP")).toBe("webp");
  });

  it("accepts only raster image files", () => {
    expect(isNotePasteImageFile(png())).toBe(true);
    expect(isNotePasteImageFile(new File(["hi"], "a.txt", { type: "text/plain" }))).toBe(false);
    expect(isNotePasteImageFile(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).toBe(false);
  });
});

describe("validateNotePasteImage", () => {
  it("passes a normal image and rejects non-raster, empty and oversized files", () => {
    expect(validateNotePasteImage(png())).toBeNull();
    expect(validateNotePasteImage(new File(["x"], "a.pdf", { type: "application/pdf" }))).toMatch(
      /supported image/,
    );
    expect(validateNotePasteImage(png(0))).toMatch(/empty/);
    expect(validateNotePasteImage(png(NOTES_PASTE_IMAGE_MAX_BYTES + 1))).toMatch(/8 MB max/);
  });
});

describe("uploadNotePasteImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts multipart to /api/notes-media and returns the url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "/api/notes-media/h.png" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadNotePasteImage(png())).resolves.toEqual({ ok: true, url: "/api/notes-media/h.png" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/notes-media");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("surfaces the server error and skips the request for invalid files", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "Image is empty." }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadNotePasteImage(png())).resolves.toEqual({ ok: false, error: "Image is empty." });
    fetchMock.mockClear();
    const big = await uploadNotePasteImage(png(NOTES_PASTE_IMAGE_MAX_BYTES + 1));
    expect(big.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(uploadNotePasteImage(png())).resolves.toEqual({ ok: false, error: "offline" });
  });
});
