import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the migration of request-body validation.
 *
 * Route handlers used to read bodies with `await req.json() as T` — a type
 * assertion over whatever the client sent, which made the compiler confidently
 * wrong about the shape and turned should-be-400s into 500s (or worse, fed
 * unchecked values to path joins and spawn arguments).
 *
 * `parseBody(req, Schema)` fixes that, but 50-odd routes cannot migrate in one
 * change. So this test enforces a ratchet:
 *
 *   - A route that reads a body and does NOT validate must be listed below.
 *   - A listed route that HAS been migrated must be removed from the list.
 *
 * The first rule stops new unvalidated routes landing. The second stops the
 * list going stale, and means it can only ever shrink. When it hits zero,
 * delete the allowlist and keep the first assertion.
 */
const DASHBOARD_DIR = path.join(__dirname, "..");
const API_DIR = path.join(DASHBOARD_DIR, "app", "api");

/** Routes still reading a body without a schema. Only ever remove entries. */
const UNVALIDATED_ALLOWLIST = new Set<string>([
  "agent-cli/route.ts",
  "agents/[name]/route.ts",
  "agents/route.ts",
  "capability/digest/route.ts",
  "capability/journey/adopt/route.ts",
  "capability/journey/complete/route.ts",
  "capability/journey/route.ts",
  "capability/journey/session/route.ts",
  "capability/journey/tutor/route.ts",
  "datadog/investigate/route.ts",
  "jobs/[id]/route.ts",
  "jobs/route.ts",
  "mcp/route.ts",
  "notes/ai/chat/route.ts",
  "persona/route.ts",
  "repos/[name]/branches/route.ts",
  "repos/[name]/git/commit-message/route.ts",
  "repos/[name]/git/stage/route.ts",
  "repos/[name]/git/stash/route.ts",
  "repos/[name]/learn/tutor/route.ts",
  "scripts/route.ts",
  "skills/[name]/route.ts",
  "skills/route.ts",
]);

function routeFiles(): string[] {
  // Plugin routes are materialised but untracked; each plugin owns its validation.
  return execFileSync("git", ["ls-files", "--", "app/api"], {
    cwd: DASHBOARD_DIR,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith("/route.ts"))
    .map((file) => path.relative("app/api", file));
}

/** Does the handler read a JSON body at all? */
function readsBody(source: string): boolean {
  return /\b(?:req|request)\.json\(\)|parseBody\s*\(/.test(source);
}

/** Does it validate that body — via `parseBody(req, Schema)` or an explicit parse? */
function validatesBody(source: string): boolean {
  const twoArgParseBody = /parseBody\s*\(\s*\w+\s*,/.test(source);
  const explicitParse = /\.(?:safeParse|parse)\s*\(/.test(source);
  return twoArgParseBody || explicitParse;
}

describe("API request-body validation", () => {
  const files = routeFiles().sort();

  it("finds route handlers to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no new route reads a body without validating it", () => {
    const offenders = files.filter((rel) => {
      const source = fs.readFileSync(path.join(API_DIR, rel), "utf8");
      return readsBody(source) && !validatesBody(source) && !UNVALIDATED_ALLOWLIST.has(rel);
    });

    expect(
      offenders,
      "These routes read a JSON body without a zod schema. Use " +
        "`parseBody(req, Schema)` from lib/api-utils — don't add them to the allowlist.",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const stale = [...UNVALIDATED_ALLOWLIST].filter((rel) => {
      const full = path.join(API_DIR, rel);
      if (!fs.existsSync(full)) return true; // route deleted or renamed
      const source = fs.readFileSync(full, "utf8");
      return !readsBody(source) || validatesBody(source);
    });

    expect(
      stale.sort(),
      "These routes are now validated (or gone). Remove them from " +
        "UNVALIDATED_ALLOWLIST — the list is a ratchet and must only shrink.",
    ).toEqual([]);
  });
});
