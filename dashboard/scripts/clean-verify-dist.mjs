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

/** The Turbopack cache is never pruned by Next and reached 20 GB. Past this size, start cold once rather than grow for ever. */
const CACHE_LIMIT_BYTES = 3 * 1024 ** 3;

function sizeOf(target) {
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : entry.isFile() ? fs.statSync(full).size : 0;
  }
  return total;
}

const dist = path.join(process.cwd(), ".next-verify");
const cache = path.join(dist, "cache");
if (fs.existsSync(cache) && sizeOf(cache) > CACHE_LIMIT_BYTES) fs.rmSync(cache, { recursive: true, force: true });
if (fs.existsSync(dist)) {
  for (const entry of fs.readdirSync(dist)) {
    if (entry === "cache") continue;
    fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
  }
}
