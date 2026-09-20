const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Clipboard files sometimes omit their MIME type. */
export function isImageAttach(mime: string, name: string): boolean {
  const base = name.trim().split(/[/\\]/).pop() ?? name;
  const extension = base.slice(base.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_MIME_TYPES.has(mime.toLowerCase()) || IMAGE_EXTENSIONS.has(extension);
}
