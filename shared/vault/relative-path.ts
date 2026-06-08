/** Normalize a repo-relative path segment list (`..`, `.`, duplicates). */
export function normalizeRelativePath(raw: string): string {
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

export function parentDir(slug: string): string {
  const segments = slug.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function joinRelative(baseDir: string, href: string): string {
  const normalized = href.replace(/\\/g, "/").replace(/^\//, "");
  if (!baseDir) return normalizeRelativePath(normalized);
  return normalizeRelativePath(`${baseDir}/${normalized}`);
}

export function stripExtension(raw: string, extension: string): string {
  const extRe = new RegExp(`${extension.replace(".", "\\.")}$`, "i");
  return raw.replace(extRe, "");
}
