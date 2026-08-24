/**
 * Clear the verify build's output without throwing away its cache.
 *
 * `rm -rf .next-verify` used to run before every verify build, which meant
 * every pre-push started the bundler from a cold cache. The output has to go
 * — a stale page or manifest is exactly what the gate exists to catch — but
 * the cache directory is content-addressed and safe to keep, and keeping it
 * is worth minutes across a day of pushes.
 */
import fs from "node:fs";
import path from "node:path";

const dist = path.join(process.cwd(), ".next-verify");
if (fs.existsSync(dist)) {
  for (const entry of fs.readdirSync(dist)) {
    if (entry === "cache") continue;
    fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
  }
}
