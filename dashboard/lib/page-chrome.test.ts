import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the chrome every page is supposed to come with.
 *
 * Three things kept getting forgotten on new routes, and none of them fail
 * loudly — the page just quietly works worse:
 *
 *   1. A title that re-appends the site name, so the tab reads
 *      "Daily rep · DevHub · DevHub". The root layout's template is
 *      `"%s · DevHub"`; pages pass the bare title.
 *   2. No `error.tsx`, so a thrown render takes out the whole app shell
 *      instead of the one route.
 *   3. No `loading.tsx`, so navigation hangs on the old page with no feedback.
 *
 * (2) and (3) use a ratchet: routes that predate the convention are listed,
 * and the lists may only shrink. New routes get no exemption.
 *
 * Everything here walks the *tracked* tree, not the working directory.
 * Directories like `app/ops` are plugin overlays materialised locally and
 * git-excluded; holding them to these rules would make the suite pass or fail
 * depending on which plugins a machine has synced.
 */
const REPO_DIR = path.join(__dirname, "..");
const APP_DIR = path.join(REPO_DIR, "app");

/** Repo-relative paths of every tracked file under dashboard/. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "app", "components"], {
    cwd: REPO_DIR,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function routeDirs(): string[] {
  return trackedFiles()
    .filter((f) => f.startsWith("app/") && f.endsWith("/page.tsx") && !f.startsWith("app/api/"))
    .map((f) => path.dirname(f).slice("app/".length))
    .sort();
}

/**
 * Routes that legitimately have no chrome, and why. A route earns a place here
 * by rendering nothing of its own — not by being new. Two shapes qualify:
 *
 *   redirect — the page body is a `redirect()` call, so there is no render to
 *              fail and nothing to show a spinner for.
 *   shell    — the page returns `null`; its content is a persistent component
 *              mounted in the root layout so a CLI session or iframe survives
 *              client-side navigation. An error boundary here would never
 *              catch that component's failures, and a loading state would
 *              flash over nothing.
 *
 * Anything that actually renders needs both files. Adding a route here is a
 * claim about its shape, and the last test in this file checks that claim.
 */
const CHROME_EXEMPT: Record<string, "redirect" | "shell"> = {
  activity: "redirect",
  tasks: "redirect",
  chamber: "shell",
  claude: "shell",
  cursor: "shell",
  opencode: "shell",
};

describe("page chrome", () => {
  const routes = routeDirs();

  it("finds the app's routes at all", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it("never hardcodes the site suffix the root template already adds", () => {
    const offenders = routes.filter((r) => {
      const src = fs.readFileSync(path.join(APP_DIR, r, "page.tsx"), "utf8");
      return /title:\s*"[^"]*·\s*DevHub"/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("gives every route that renders something an error boundary", () => {
    const missing = routes.filter(
      (r) => !(r in CHROME_EXEMPT) && !fs.existsSync(path.join(APP_DIR, r, "error.tsx")),
    );
    expect(missing).toEqual([]);
  });

  it("gives every route that renders something a loading state", () => {
    const missing = routes.filter(
      (r) => !(r in CHROME_EXEMPT) && !fs.existsSync(path.join(APP_DIR, r, "loading.tsx")),
    );
    expect(missing).toEqual([]);
  });

  it("only exempts routes that really are redirects or empty shells", () => {
    const wrong: string[] = [];
    for (const [route, shape] of Object.entries(CHROME_EXEMPT)) {
      const file = path.join(APP_DIR, route, "page.tsx");
      if (!fs.existsSync(file)) {
        wrong.push(`${route} (no page.tsx — stale entry)`);
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      const isRedirect = /\bredirect\(/.test(src);
      const isShell = /return null;/.test(src);
      if (shape === "redirect" && !isRedirect) wrong.push(`${route} (claims redirect, isn't one)`);
      if (shape === "shell" && !isShell) wrong.push(`${route} (claims shell, renders something)`);
    }
    expect(wrong).toEqual([]);
  });

  it("renders page titles as headings, not styled divs", () => {
    // A `<div class="page-title">` looks identical and is invisible to screen
    // readers: 18 pages had no <h1> at all until this was fixed.
    const offenders = trackedFiles()
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /<div[^>]*className="page-title"/.test(fs.readFileSync(path.join(REPO_DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
