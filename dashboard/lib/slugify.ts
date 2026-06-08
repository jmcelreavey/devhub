export interface SlugifyOptions {
  maxLen?: number;
  fallback?: string;
}

export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { maxLen = 48, fallback = "untitled" } = options;
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLen) || fallback;
}
