/**
 * Resolve image sources in docs so they render both on GitHub and in DevHub.
 *
 * ## The conflict
 *
 * `docs/guides/vendored-skills.md` embeds its demo GIFs as
 * `../assets/demos/scope-creep-detector.gif`. That is the portable form: GitHub
 * resolves it against the file's own directory and shows the image. DevHub's
 * docs viewer rendered the same string straight into `<img src>`, where the
 * browser resolved it against the *route* — `/docs/guides/…` — and asked for
 * `/docs/assets/demos/…`, which is a page route, not a file. Every demo showed
 * as a broken image.
 *
 * The two obvious fixes each break one reader. Rewriting the markdown to an
 * absolute `/api/docs-assets/…` renders in DevHub and breaks on GitHub;
 * leaving it relative does the reverse. So the markdown stays portable and the
 * viewer does the resolution, which is the only option where both readers work.
 *
 * ## Security
 *
 * The resolved path is served by a route that reads from `DOCS_DIR`, so a doc
 * containing `![x](../../../../.ssh/id_rsa)` must not escape it. Resolution is
 * done on a normalised segment stack and anything that walks above the docs
 * root returns null rather than being clamped — a request that meant to escape
 * should fail visibly, not be silently rewritten into a different file.
 */

/** Extensions the docs asset route will serve. */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function contentTypeForDocAsset(relPath: string): string | null {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return null;
  return ASSET_CONTENT_TYPES[relPath.slice(dot).toLowerCase()] ?? null;
}

/** Already a URL, a data URI, or root-absolute — leave it alone. */
function isAbsoluteSrc(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src);
}

/**
 * Normalise `docDir` + `src` into a docs-root-relative path.
 *
 * Returns null when the result would escape the docs root, or when the source
 * is absolute and needs no rewriting.
 */
export function resolveDocAssetPath(src: string, docPath: string): string | null {
  if (!src || isAbsoluteSrc(src)) return null;

  // docPath is the doc's path relative to DOCS_DIR, e.g. "guides/vendored-skills.md".
  const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const stack: string[] = docDir ? docDir.split("/").filter(Boolean) : [];

  // A source made only of "." and "/" resolves to the doc's own directory,
  // which is not a file. Without this, "./" quietly becomes a request for
  // "guides" and the route 404s on something that looked resolvable.
  let namedSomething = false;

  for (const segment of src.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") namedSomething = true;
    if (segment === "..") {
      // Escaping the docs root is a failure, not something to clamp: silently
      // resolving to a different file is worse than showing nothing.
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (!namedSomething || stack.length === 0) return null;
  const rel = stack.join("/");
  // Belt and braces — no encoded traversal or absolute escape should survive.
  if (rel.includes("..") || rel.startsWith("/")) return null;
  return rel;
}

/**
 * The `src` to put in the rendered `<img>`.
 *
 * Falls back to the original string when the source is absolute or cannot be
 * resolved, so an external image or an unusual path renders exactly as the
 * author wrote it.
 */
export function docAssetSrc(src: string, docPath: string | undefined): string {
  if (!docPath) return src;
  const rel = resolveDocAssetPath(src, docPath);
  if (!rel) return src;
  return `/api/docs-assets/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Rewrite every image `src` in a parsed doc tree.
 *
 * A whole-tree pass rather than resolution at render time, for two reasons.
 * `DocContent` is a Server Component, so a React context is unavailable — that
 * attempt failed the production build while passing both tsc and eslint, which
 * is worth remembering: neither catches a server/client boundary violation.
 *
 * The better reason is shape. Doing it here keeps the renderer a pure function
 * of its nodes and confines knowledge of the doc's location to one call.
 *
 * Deliberately structural rather than typed against the node union: the parser
 * has a large and growing set of block and inline types, and a walk that only
 * knew today's containers would silently miss images nested in a callout or a
 * table cell added later.
 */
export function resolveDocAssets<T>(nodes: T, docPath: string | undefined): T {
  if (!docPath) return nodes;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;

    const record = value as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) mapped[key] = walk(child);

    if (record.type === "image" && typeof record.src === "string") {
      mapped.src = docAssetSrc(record.src, docPath);
    }
    return mapped;
  };

  return walk(nodes) as T;
}
