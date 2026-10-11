// Bundles the game with esbuild and serves it (plus /pong assets) on a free
// port, with no Next.js build. Used by screens.mjs; also runnable directly.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dashboard = path.join(repoRoot, "dashboard");
const require = createRequire(path.join(dashboard, "package.json"));
const esbuild = require("esbuild");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".json": "application/json", ".png": "image/png" };

export async function startHarness() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "pong-harness-"));
  await esbuild.build({
    entryPoints: [path.join(here, "entry.tsx")],
    outfile: path.join(out, "harness.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    sourcemap: "inline",
    tsconfig: path.join(dashboard, "tsconfig.json"),
    nodePaths: [path.join(dashboard, "node_modules")],
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".json": "json" },
    logLevel: "warning",
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>pong harness</title>
<style>html,body{margin:0;height:100%;background:#000}</style></head>
<body><div id="root"></div><script>window.__PONG_HARNESS__=true;</script><script src="/harness.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/" ) { res.writeHead(200, { "content-type": MIME[".html"] }); res.end(html); return; }
    if (url.pathname === "/harness.js") { res.writeHead(200, { "content-type": MIME[".js"] }); res.end(fs.readFileSync(path.join(out, "harness.js"))); return; }
    const file = path.normalize(path.join(dashboard, "public", url.pathname));
    if (!file.startsWith(path.join(dashboard, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((r) => { server.close(() => { fs.rmSync(out, { recursive: true, force: true }); r(); }); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const h = await startHarness();
  console.log(`pong harness: ${h.url}`);
}
