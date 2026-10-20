import { describe, expect, it, vi } from "vitest";
import { NoteImageRejectedError, createNoteImageUploader } from "./editor-upload";

const png = () => new File([new Uint8Array([1])], "shot.png", { type: "image/png" });

describe("createNoteImageUploader", () => {
  it("resolves to the stored url", async () => {
    const notify = vi.fn();
    const discardPlaceholder = vi.fn();
    const upload = vi.fn().mockResolvedValue({ ok: true, url: "/api/notes-media/x.png" });
    const uploadFile = createNoteImageUploader({ notify, discardPlaceholder, upload });

    await expect(uploadFile(png(), "b1")).resolves.toBe("/api/notes-media/x.png");
    expect(notify).not.toHaveBeenCalled();
    expect(discardPlaceholder).not.toHaveBeenCalled();
  });

  it("toasts, drops the placeholder and throws on rejection", async () => {
    const notify = vi.fn();
    const discardPlaceholder = vi.fn();
    const upload = vi.fn().mockResolvedValue({ ok: false, error: "too big (8 MB max)." });
    const uploadFile = createNoteImageUploader({ notify, discardPlaceholder, upload });

    await expect(uploadFile(png(), "b1")).rejects.toBeInstanceOf(NoteImageRejectedError);
    expect(notify).toHaveBeenCalledWith("too big (8 MB max).");
    expect(discardPlaceholder).toHaveBeenCalledWith("b1");
  });

  it("does not discard when there is no block id", async () => {
    const discardPlaceholder = vi.fn();
    const upload = vi.fn().mockResolvedValue({ ok: false, error: "nope" });
    const uploadFile = createNoteImageUploader({ notify: vi.fn(), discardPlaceholder, upload });

    await expect(uploadFile(png())).rejects.toThrow("nope");
    expect(discardPlaceholder).not.toHaveBeenCalled();
  });
});
