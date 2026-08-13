import { describe, expect, it } from "vitest";
import { deriveTeams, inferTeamsFromChurn, needsChurnInference, teamForDomains } from "./teams";
import type { DomainContribution, RepoDomain } from "./types";

function domain(id: string, codeowners: string[] = []): RepoDomain {
  return { id, label: id, paths: [id], source: "directory", codeowners };
}

describe("team derivation tiers", () => {
  it("prefers explicit overrides over everything else", () => {
    const teams = deriveTeams(
      [domain("api", ["@acme/platform"])],
      [{ id: "mine", label: "My team", domains: ["api"] }],
      [{ author: "alice@acme.com", domainId: "api", commits: 40 }],
    );
    expect(teams).toEqual([{ id: "mine", label: "My team", domains: ["api"], source: "override", members: [] }]);
  });

  it("uses CODEOWNERS teams when present, without paying for churn", () => {
    const teams = deriveTeams([domain("api", ["@acme/platform"]), domain("web", ["@acme/web"])]);
    expect(teams.map((team) => team.label)).toEqual(["@acme/platform", "@acme/web"]);
    expect(teams.every((team) => team.source === "codeowners")).toBe(true);
    expect(needsChurnInference(teams)).toBe(false);
  });

  it("ignores individual CODEOWNERS, which are people rather than teams", () => {
    // Grouping by individual owners produces one bucket per reviewer, which is
    // not a grouping at all.
    const teams = deriveTeams([domain("api", ["@alice", "@bob"])]);
    expect(teams).toHaveLength(1);
    expect(teams[0]?.source).toBe("unknown");
    expect(needsChurnInference(teams)).toBe(true);
  });

  it("falls back to a single Unknown bucket with no evidence at all", () => {
    const teams = deriveTeams([domain("api")]);
    expect(teams).toEqual([{ id: "unknown", label: "Unknown", source: "unknown", domains: [], members: [] }]);
  });

  it("infers groupings from churn when CODEOWNERS is absent", () => {
    const contributions: DomainContribution[] = [
      { author: "alice@acme.com", domainId: "api", commits: 20 },
      { author: "bob@acme.com", domainId: "api", commits: 12 },
      { author: "carol@acme.com", domainId: "web", commits: 15 },
    ];
    const teams = deriveTeams([domain("api"), domain("web")], null, contributions);
    expect(teams.map((team) => team.label)).toEqual(["~api", "~web"]);
    expect(teams.every((team) => team.source === "churn")).toBe(true);
    expect(teams.find((team) => team.label === "~api")?.members).toEqual(["alice@acme.com", "bob@acme.com"]);
  });
});

describe("churn inference guardrails", () => {
  it("does not assign an author who is spread evenly across domains", () => {
    const teams = inferTeamsFromChurn(
      [domain("api"), domain("web"), domain("infra")],
      [
        { author: "alice@acme.com", domainId: "api", commits: 10 },
        { author: "alice@acme.com", domainId: "web", commits: 10 },
        { author: "alice@acme.com", domainId: "infra", commits: 10 },
      ],
    );
    expect(teams).toEqual([]);
  });

  it("assigns an author with a clear primary domain", () => {
    const teams = inferTeamsFromChurn(
      [domain("api"), domain("web")],
      [
        { author: "alice@acme.com", domainId: "api", commits: 30 },
        { author: "alice@acme.com", domainId: "web", commits: 2 },
      ],
    );
    expect(teams).toEqual([
      { id: "churn-api", label: "~api", source: "churn", domains: ["api"], members: ["alice@acme.com"] },
    ]);
  });

  it("ignores a drive-by commit rather than inventing a team from it", () => {
    const teams = inferTeamsFromChurn([domain("api")], [{ author: "alice@acme.com", domainId: "api", commits: 1 }]);
    expect(teams).toEqual([]);
  });

  it("labels inferred groupings so they never read as declared owners", () => {
    const teams = inferTeamsFromChurn([domain("api")], [{ author: "a@x.com", domainId: "api", commits: 9 }]);
    expect(teams[0]?.label.startsWith("~")).toBe(true);
    expect(teams[0]?.source).toBe("churn");
  });
});

describe("teamForDomains", () => {
  it("matches a PR to the team owning any domain it touches", () => {
    const teams = deriveTeams([domain("api", ["@acme/platform"]), domain("web", ["@acme/web"])]);
    expect(teamForDomains(teams, ["web"])).toBe("@acme/web");
  });

  it("falls back to Unknown for a PR touching nothing mapped", () => {
    const teams = deriveTeams([domain("api", ["@acme/platform"])]);
    expect(teamForDomains(teams, ["docs"])).toBe("Unknown");
  });
});
