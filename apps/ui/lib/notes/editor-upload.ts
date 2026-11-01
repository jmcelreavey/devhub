import { uploadNotePasteImage } from "@/lib/notes/paste-image";

/** Thrown after the user has been told; aborts BlockNote's block update. */
export class NoteImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteImageRejectedError";
  }
}

interface NoteImageUploaderDeps {
  /** Surfaces the rejection to the user (toast). */
  notify: (message: string) => void;
  /**
   * Drops the placeholder image block BlockNote inserted for this upload.
   * Only called when the block has no URL yet, so a failed re-upload never
   * deletes an image that already rendered.
   */
  discardPlaceholder: (blockId: string) => void;
  upload?: typeof uploadNotePasteImage;
}

/**
 * `uploadFile` for BlockNote: handles paste, drop and the image block's Upload tab.
 * Resolves to the stored URL; on failure toasts, removes the empty placeholder and throws.
 */
export function createNoteImageUploader({
  notify,
  discardPlaceholder,
  upload = uploadNotePasteImage,
}: NoteImageUploaderDeps) {
  return async (file: File, blockId?: string): Promise<string> => {
    const result = await upload(file);
    if (result.ok) return result.url;
    notify(result.error);
    if (blockId) discardPlaceholder(blockId);
    throw new NoteImageRejectedError(result.error);
  };
}
