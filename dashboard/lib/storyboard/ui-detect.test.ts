import { describe, expect, it } from "vitest";
import { detectUiChange, isUiPath, planPaths } from "./ui-detect";

describe("isUiPath", () => {
  it("counts components, styles and screen code, not APIs, tests or types", () => {
    for (const file of ["app/storyboard/NoteCard.tsx", "src/styles/main.css", "screens/Home.ts", "components/Button.js", "web/index.html", "src/App.vue"]) expect(isUiPath(file)).toBe(true);
    for (const file of ["app/api/qa/route.ts", "lib/qa/service.ts", "app/storyboard/client.test.tsx", "types/index.d.ts", "scripts/build.ts", "server/handlers.ts", "app/x/route.ts"]) expect(isUiPath(file)).toBe(false);
  });
});

describe("planPaths", () => {
  it("reads file paths from the ## Plan section only", () => {
    const md = "## Description\nThe login button (see docs.md) is broken.\n\n## Plan\n- Edit `app/login/page.tsx` and lib/auth.ts.\n- Run tests.\n\n## Acceptance\n- styles.css untouched";
    expect(planPaths(md)).toEqual(["app/login/page.tsx", "lib/auth.ts"]);
    expect(planPaths("Change lib/db.ts")).toEqual(["lib/db.ts"]);
    expect(planPaths(null)).toEqual([]);
  });
});

describe("detectUiChange", () => {
  it("prefers changed files over the plan", () => {
    expect(detectUiChange({ changedFiles: ["lib/a.ts", "app/x/Panel.tsx"], planPaths: ["lib/a.ts"] })).toEqual({ detected: true, reason: "changes app/x/Panel.tsx" });
    expect(detectUiChange({ changedFiles: ["lib/a.ts"], planPaths: ["app/x/Panel.tsx"] })).toEqual({ detected: false, reason: "1 changed file, none of them UI" });
  });

  it("falls back to the plan's paths, then says it can't tell", () => {
    expect(detectUiChange({ planPaths: ["app/a.tsx", "app/b.css", "lib/c.ts"] })).toEqual({ detected: true, reason: "plan touches app/a.tsx and 1 more UI file" });
    expect(detectUiChange({ planPaths: ["lib/c.ts"] }).detected).toBe(false);
    // Wording alone no longer makes a UI change.
    expect(detectUiChange({})).toEqual({ detected: false, reason: "no changed files or planned paths yet" });
  });
});
