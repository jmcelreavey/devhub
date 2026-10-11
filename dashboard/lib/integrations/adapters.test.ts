import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/gh-exec", () => ({ execGh: vi.fn(), githubCliErrorInfo: () => ({ kind: "auth" }) }));
vi.mock("@/lib/jira/env", () => ({ getResolvedJiraEnv: () => ({ domain: "example.atlassian.net", email: "user@example.test", apiToken: "secret" }), apiBase: () => "https://example.atlassian.net/rest/api/3", jsonHeaders: () => ({ Authorization: "test" }) }));
vi.mock("./accounts", () => ({ accountsFor: () => [], accountConfig: (_provider: string, id: string) => ({ tokenRef: id + "_TOKEN", domain: "example.atlassian.net", emailRef: "EMAIL" }), credential: (ref: string) => ref }));
import { execGh } from "@/lib/gh-exec";
import { githubProvider } from "./github";
import { jiraProvider } from "./jira";
import { createRegistry, providerFor } from "./registry";
import { assertCapability, refKey } from "./types";
import { providerJson } from "./http";
const context = { signal: new AbortController().signal };
const issue = { number: 42, title: "Example", html_url: "https://github.com/org/repo/issues/42", state: "open", updated_at: "2026-10-09T10:00:00Z" };
const jira = { key: "APP-42", fields: { summary: "Example", updated: "r2", status: { id: "10002", name: "In progress", statusCategory: { key: "indeterminate" } } } };
const mockedFetch = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mockedFetch); });
afterEach(() => vi.unstubAllGlobals());
describe("capability adapters", () => {
  it("preserves Jira native IDs and opaque pagination", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json({ accountId: "a" })).mockResolvedValueOnce(Response.json({ issues: [jira], nextPageToken: "opaque-next", isLast: false }));
    const page = await jiraProvider.search!("default", "issue", "project = APP", "opaque-before", context);
    expect(page.items[0].status).toEqual({ id: "10002", label: "In progress", category: "indeterminate" });
    expect(page.next).toBe("opaque-next");
    expect(JSON.parse(mockedFetch.mock.calls[1][1].body).nextPageToken).toBe("opaque-before");
    mockedFetch.mockResolvedValueOnce(Response.json({ transitions: [{ id: "31", name: "Done", to: { id: "10004" } }] }));
    expect(await jiraProvider.transitions!(page.items[0].ref, context)).toEqual([{ id: "31", label: "Done", statusId: "10004" }]);
  });
  it("keeps overlapping IDs in two GitHub accounts separate", async () => {
    mockedFetch.mockImplementation(async () => Response.json(issue));
    const one = await githubProvider.get({ provider: "github", account: "work", kind: "issue", id: "org/repo/42" }, context);
    const two = await githubProvider.get({ ...one.ref, account: "personal" }, context);
    expect(refKey(one.ref)).not.toBe(refKey(two.ref));
    expect(mockedFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer work_TOKEN");
    expect(mockedFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer personal_TOKEN");
  });
  it("uses gh login without migrating credentials and preserves draft state", async () => {
    vi.mocked(execGh).mockResolvedValue({ stdout: JSON.stringify({ items: [{ ...issue, draft: true, html_url: "https://github.com/org/repo/pull/42" }], total_count: 31 }), stderr: "" });
    const page = await githubProvider.search!("default", "pr", "repo:org/repo", undefined, context);
    expect(page.items[0]).toMatchObject({ draft: true, ref: { kind: "pr", id: "org/repo/42" } });
    expect(page.next).toBe("2");
    expect(vi.mocked(execGh).mock.calls[0][0].join(" ")).toContain("is%3Apr");
  });
  it("paginates check runs with native conclusion and head revision", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json({ ...issue, head: { sha: "abc" } })).mockResolvedValueOnce(Response.json({ total_count: 101, check_runs: [{ id: 7, name: "build", html_url: "https://github.com/org/repo/actions/runs/7", status: "completed", conclusion: "failure" }] }));
    const page = await githubProvider.checks!({ provider: "github", account: "work", kind: "pr", id: "org/repo/42" }, context);
    expect(page.next).toBe("2"); expect(page.items[0]).toMatchObject({ revision: "abc", status: { id: "failure" }, ref: { kind: "check" } });
  });
  it("reports auth, limits and conflicts without provider secrets", async () => {
    for (const [status, kind] of [[401, "auth"], [429, "rate-limit"], [412, "conflict"]] as const) {
      mockedFetch.mockResolvedValueOnce(new Response("secret response", { status, headers: { "Retry-After": "17" } }));
      await expect(providerJson("https://example.test", {}, context.signal)).rejects.toMatchObject({ kind, ...(status === 429 ? { retryAfter: 17 } : {}) });
    }
    mockedFetch.mockRejectedValueOnce(new Error("URL with secret"));
    await expect(providerJson("https://example.test", {}, context.signal)).rejects.not.toThrow("secret");
  });
  it("rejects duplicate and unsupported providers and never infers write authority", () => {
    expect(() => createRegistry([jiraProvider, jiraProvider])).toThrow("Duplicate");
    expect(() => createRegistry([{ ...jiraProvider, apiVersion: 2 } as unknown as typeof jiraProvider])).toThrow("contract");
    expect(() => providerFor("disabled-plugin")).toThrow("absent");
    expect(() => assertCapability(githubProvider, "pr.merge")).toThrow("does not support");
    expect(() => assertCapability(jiraProvider, "issue.delete")).toThrow("does not support");
    expect(() => assertCapability(githubProvider, "pr.create")).not.toThrow();
    expect(() => assertCapability(jiraProvider, "issue.transition")).not.toThrow();
  });
});
