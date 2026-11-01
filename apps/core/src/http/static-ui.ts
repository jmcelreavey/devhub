import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contentTypes: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

function requestPath(rawTarget: string): string | null {
  try {
    const rawPath = rawTarget.split("?", 1)[0];
    if (!rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.includes("#")) return null;
    const decoded = decodeURIComponent(rawPath);
    // eslint-disable-next-line no-control-regex -- Reject control characters in decoded paths.
    if (/[\\\x00-\x1f\x7f]/.test(decoded) || /%(?:2e|2f|5c|25)/i.test(decoded)) return null;
    if (decoded.split("/").some(segment => segment.startsWith("."))) return null;
    return decoded;
  } catch {
    return null;
  }
}

function acceptsHtml(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode && mode !== "navigate") return false;
  return (request.headers.get("accept") ?? "").split(",").some(value => {
    const [type, ...parameters] = value.trim().toLowerCase().split(";");
    if (type.trim() !== "text/html") return false;
    const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith("q="));
    return quality === undefined || (Number(quality.slice(2)) > 0 && Number(quality.slice(2)) <= 1);
  });
}

async function readBuiltFile(root: string, relativePath: string, request: Request, contentType: string, cacheControl: string): Promise<Response | null> {
  try {
    const realRoot = await realpath(root);
    const filename = path.join(realRoot, relativePath);
    // A build artifact must not redirect the server to another file via a symlink.
    if (await realpath(filename) !== filename) return null;
    const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return null;
      const headers = {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        ...(contentType.startsWith("text/html") ? { Vary: "Accept, Sec-Fetch-Mode" } : {}),
      };
      const body = request.method === "HEAD" ? null : Uint8Array.from(await file.readFile());
      return new Response(body, { headers });
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(error.code))) return null;
    throw error;
  }
}

/** Serve only built output; unmatched requests remain available for the server's 404. */
export async function serveStaticUi(request: Request, rawTarget: string, root?: string): Promise<Response | null> {
  root ??= process.env.DEVHUB_UI_DIST?.trim()
    || (process.env.DEVHUB_CORE_PAYLOAD === "1" && process.env.DEVHUB_RESOURCE_ROOT
      ? path.join(process.env.DEVHUB_RESOURCE_ROOT, "ui/dist")
      : import.meta.url ? fileURLToPath(new URL("../../../ui/dist/", import.meta.url)) : undefined);
  if (!root) throw new Error("UI dist path is not configured");
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const pathname = requestPath(rawTarget);
  if (!pathname || pathname === "/api" || pathname.startsWith("/api/")) return null;

  const extension = path.posix.extname(pathname).toLowerCase();
  const contentType = contentTypes[extension];
  if (contentType) {
    const hashed = pathname.startsWith("/assets/") && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname);
    // Scripts, styles and Wasm are emitted with hashes; don't serve source files.
    if ((extension === ".js" || extension === ".css" || extension === ".wasm") && !hashed) return null;
    return readBuiltFile(root, pathname.slice(1), request, contentType, hashed ? "public, max-age=31536000, immutable" : "no-cache");
  }

  if (pathname === "/assets" || pathname.startsWith("/assets/")) return null;
  // Note and repository names can contain dots; other dotted paths are asset requests.
  const noteLink = (pathname.startsWith("/notes/") || pathname.startsWith("/diagrams/")) && extension === ".md";
  const repoLink = /^\/(?:repos\/(?:learn\/)?[^/]+|own\/[^/]+\/[^/]+)$/.test(pathname);
  if (extension && pathname !== "/index.html" && !noteLink && !repoLink) return null;
  if (pathname !== "/index.html" && !acceptsHtml(request)) return null;
  return readBuiltFile(root, "index.html", request, "text/html; charset=utf-8", "no-store");
}
