import { describe, expect, it } from "vitest";
import {
  buildPeople,
  indexByEmail,
  lookupByEmail,
  personForEmail,
  type AuthorSighting,
  type GithubAccount,
} from "@/lib/people/identity";

function sightings(...pairs: [name: string, email: string, count?: number][]): AuthorSighting[] {
  return pairs.flatMap(([name, email, count = 1]) =>
    Array.from({ length: count }, () => ({ name, email })),
  );
}

function account(login: string, id = 1): GithubAccount {
  return { login, avatarUrl: `https://avatars.githubusercontent.com/u/${id}?v=4` };
}

describe("buildPeople", () => {
  it("keeps two unrelated authors apart", () => {
    const people = buildPeople(
      sightings(["Ada", "ada@example.com"], ["Grace", "grace@example.com"]),
      {},
    );
    expect(people).toHaveLength(2);
  });

  it("merges two addresses that GitHub attributes to one account", () => {
    // The strong rule: GitHub asserting both addresses belong to one login.
    const people = buildPeople(sightings(["Ada", "ada@work.com"], ["Ada L", "ada@home.com"]), {
      "ada@work.com": account("ada"),
      "ada@home.com": account("ada"),
    });
    expect(people).toHaveLength(1);
    expect(people[0]?.emails).toEqual(["ada@home.com", "ada@work.com"]);
    expect(people[0]?.githubLogin).toBe("ada");
  });

  it("folds an unattributed address into the account with the same name", () => {
    // This is John's case: the work address resolves, the personal one does not,
    // and without this rule he renders as two people on one screen.
    const people = buildPeople(
      sightings(
        ["John McElreavey", "jmcelreavey@insider.com", 4],
        ["John McElreavey", "j.mcelreavey@gmail.com", 34],
      ),
      { "jmcelreavey@insider.com": account("jmcelreavey", 7) },
    );
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      githubLogin: "jmcelreavey",
      displayName: "John McElreavey",
      commits: 38,
    });
    expect(people[0]?.emails).toEqual(["j.mcelreavey@gmail.com", "jmcelreavey@insider.com"]);
  });

  it("never merges two addresses GitHub gave different logins", () => {
    // Even with an identical display name, overriding GitHub with a string
    // comparison would be wrong.
    const people = buildPeople(sightings(["Alex Kim", "a@x.com"], ["Alex Kim", "b@y.com"]), {
      "a@x.com": account("alexkim1", 1),
      "b@y.com": account("alexkim2", 2),
    });
    expect(people).toHaveLength(2);
  });

  it("leaves an unattributed address alone when the name is ambiguous", () => {
    // Two accounts share the display name, so there is no single right answer
    // and guessing would silently attach commits to the wrong person.
    const people = buildPeople(
      sightings(["Sam Doe", "a@x.com"], ["Sam Doe", "b@y.com"], ["Sam Doe", "c@z.com"]),
      { "a@x.com": account("sam1", 1), "b@y.com": account("sam2", 2) },
    );
    expect(people).toHaveLength(3);
  });

  it("does not merge unattributed addresses with each other", () => {
    // Neither side is corroborated by GitHub, so a shared name proves nothing.
    const people = buildPeople(sightings(["Sam Doe", "a@x.com"], ["Sam Doe", "b@y.com"]), {});
    expect(people).toHaveLength(2);
  });

  it("matches names case- and whitespace-insensitively", () => {
    const people = buildPeople(
      sightings(["John  McElreavey", "work@x.com"], ["john mcelreavey", "home@y.com"]),
      { "work@x.com": account("j") },
    );
    expect(people).toHaveLength(1);
  });

  it("picks the display name attached to the most commits", () => {
    const people = buildPeople(
      sightings(["jmc", "a@x.com", 2], ["John McElreavey", "b@x.com", 9]),
      { "a@x.com": account("j"), "b@x.com": account("j") },
    );
    expect(people[0]?.displayName).toBe("John McElreavey");
  });

  it("honours an explicit override", () => {
    const people = buildPeople(
      sightings(["Bot", "ci@example.com"], ["Ada", "ada@example.com"]),
      { "ada@example.com": account("ada") },
      { "ci@example.com": "gh:ada" },
    );
    expect(people).toHaveLength(1);
    expect(people[0]?.emails).toContain("ci@example.com");
  });

  it("orders by commit count so the busiest author leads", () => {
    const people = buildPeople(sightings(["Quiet", "q@x.com", 1], ["Busy", "b@x.com", 5]), {});
    expect(people.map((p) => p.displayName)).toEqual(["Busy", "Quiet"]);
  });

  it("ignores blank addresses rather than creating a phantom person", () => {
    expect(buildPeople(sightings(["Nobody", "  "]), {})).toEqual([]);
    expect(buildPeople([], {})).toEqual([]);
  });

  it("fills an Atlassian avatar when GitHub did not attribute one", () => {
    const atl = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/ada.png";
    const people = buildPeople(
      sightings(["Ada", "ada@work.com"]),
      {},
      {},
      { "ada@work.com": atl },
    );
    expect(people).toHaveLength(1);
    expect(people[0]?.avatarUrl).toBe(atl);
  });

  it("prefers GitHub attribution over an Atlassian avatar", () => {
    const atl = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/ada.png";
    const people = buildPeople(
      sightings(["Ada", "ada@work.com"]),
      { "ada@work.com": account("ada", 9) },
      {},
      { "ada@work.com": atl },
    );
    expect(people[0]?.avatarUrl).toContain("avatars.githubusercontent.com");
    expect(people[0]?.avatarUrl).not.toContain("atl-paas.net");
  });

  it("applies Atlassian avatars after name-merge folds emails together", () => {
    const atl = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/N48x48/j.png";
    // Work address has GitHub; personal address only has Atlassian — merge should
    // keep the GitHub avatar on the combined person.
    const people = buildPeople(
      sightings(
        ["John McElreavey", "jmcelreavey@insider.com", 4],
        ["John McElreavey", "j.mcelreavey@gmail.com", 34],
      ),
      { "jmcelreavey@insider.com": account("jmcelreavey", 7) },
      {},
      { "j.mcelreavey@gmail.com": atl },
    );
    expect(people).toHaveLength(1);
    expect(people[0]?.avatarUrl).toContain("avatars.githubusercontent.com");
  });
});

describe("indexByEmail / personForEmail", () => {
  it("finds a person by any of their addresses", () => {
    const people = buildPeople(
      sightings(["Ada", "ada@work.com"], ["Ada", "ada@home.com"]),
      { "ada@work.com": account("ada"), "ada@home.com": account("ada") },
    );
    const index = indexByEmail(people);
    expect(personForEmail(index, "ada@home.com").githubLogin).toBe("ada");
    expect(personForEmail(index, "ADA@WORK.COM").githubLogin).toBe("ada");
    expect(lookupByEmail(index, "ADA@WORK.COM")?.githubLogin).toBe("ada");
  });

  it("gives graph rows and commit detail the same avatar URL for one person", () => {
    // Justin commits as gmail on mainline merges and a work address on branches.
    // GitHub only attributes one of them; name-merge must still share the photo.
    const people = buildPeople(
      sightings(
        ["JustinFerrara", "justin.p.ferrara@gmail.com"],
        ["JustinFerrara", "jferrara@businessinsider.com"],
      ),
      { "jferrara@businessinsider.com": account("JustinFerrara", 14058449) },
    );
    const index = indexByEmail(people);
    const graphEmail = "justin.p.ferrara@gmail.com";
    const detailEmail = "Justin.P.Ferrara@gmail.com";
    expect(lookupByEmail(index, graphEmail)?.avatarUrl).toBe(
      lookupByEmail(index, detailEmail)?.avatarUrl,
    );
    expect(lookupByEmail(index, graphEmail)?.avatarUrl).toContain(
      "avatars.githubusercontent.com/u/14058449",
    );
  });

  it("returns a lone person for an address it has never seen", () => {
    // Callers should not have to branch on a miss — an unknown author is still
    // a person, just one nothing else is known about.
    const person = personForEmail({}, "stranger@example.com", "A Stranger");
    expect(person).toMatchObject({
      displayName: "A Stranger",
      emails: ["stranger@example.com"],
      githubLogin: null,
    });
  });
});
