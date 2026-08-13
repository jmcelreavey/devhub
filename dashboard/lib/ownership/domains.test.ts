import { describe, expect, it } from "vitest";
import { codeownersForPath, parseCodeowners } from "./domains";

describe("CODEOWNERS matching", () => {
  it("uses the final matching rule", () => {
    const rules = parseCodeowners(`
      * @acme/core
      /apps/payments/ @acme/payments @alice
      **/*.md @acme/docs
    `);

    expect(codeownersForPath(rules, "apps/payments/src/index.ts")).toEqual(["@acme/payments", "@alice"]);
    expect(codeownersForPath(rules, "docs/runbook.md")).toEqual(["@acme/docs"]);
    expect(codeownersForPath(rules, "src/index.ts")).toEqual(["@acme/core"]);
  });

  it("does not treat a wildcard filename prefix as a domain", async () => {
    const rules = parseCodeowners("atlantis-*.yaml @acme/infra");
    expect(codeownersForPath(rules, "atlantis-prod.yaml")).toEqual(["@acme/infra"]);
  });

  it("does not let a single-star rule absorb nested files", () => {
    const rules = parseCodeowners("/docs/* @acme/docs");
    expect(codeownersForPath(rules, "docs/readme.md")).toEqual(["@acme/docs"]);
    expect(codeownersForPath(rules, "docs/guides/readme.md")).toEqual([]);
  });

  it("does not treat one owned path as coverage for its whole domain", () => {
    const rules = parseCodeowners("/src/owned/** @acme/team");
    expect(codeownersForPath(rules, "src/owned/index.ts")).toEqual(["@acme/team"]);
    expect(codeownersForPath(rules, "src/unowned.ts")).toEqual([]);
  });
});
