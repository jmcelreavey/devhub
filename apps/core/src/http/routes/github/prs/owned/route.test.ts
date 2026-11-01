import { expect, it } from "vitest";
import { GET } from "./route";

it("authenticates remote queries and rejects unsafe repository names", async () => {
  const base = "http://localhost:1457/api/github/prs/owned?scope=remote";
  const headers = { origin: "http://localhost:1457", host: "localhost:1457" };
  const unauthenticated = await GET(new Request(base));
  expect([401, 403]).toContain(unauthenticated.status);
  for (const repo of ["../invalid", "-option/repo", "owner/..", "owner/repo/extra"]) {
    const url = new URL(base);
    url.searchParams.append("repo", repo);
    const response = await GET(new Request(url, { headers }));
    expect(response.status).toBe(400);
  }
  const empty = await GET(new Request(base, { headers }));
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ prs: [], failedRepos: [], limited: false });
});
