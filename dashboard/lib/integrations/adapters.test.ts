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
  it("preserves native Jira IDs and available transitions", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json(jira));
    const item = await jiraProvider.get({ provider: "jira", account: "default", kind: "issue", id: "APP-42" }, context);
    expect(item.status).toEqual({ id: "10002", label: "In progress", category: "indeterminate" });
    mockedFetch.mockResolvedValueOnce(Response.json({ transitions: [{ id: "31", name: "Done", to: { id: "10004" } }] }));
    expect(await jiraProvider.transitions!(item.ref, context)).toEqual([{ id: "31", label: "Done", statusId: "10004" }]);
  });
  it("keeps overlapping IDs in two GitHub accounts separate", async () => {
    mockedFetch.mockImplementation(async () => Response.json(issue));
    const one = await githubProvider.get({ provider: "github", account: "work", kind: "issue", id: "org/repo/42" }, context);
    const two = await githubProvider.get({ ...one.ref, account: "personal" }, context);
    expect(refKey(one.ref)).not.toBe(refKey(two.ref));
    expect(mockedFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer work_TOKEN");
    expect(mockedFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer personal_TOKEN");
  });
  it("uses gh login without migrating credentials", async () => {
    vi.mocked(execGh).mockResolvedValue({ stdout: JSON.stringify({ ...issue, draft: true }), stderr: "" });
    const item = await githubProvider.get({ provider: "github", account: "default", kind: "pr", id: "org/repo/42" }, context);
    expect(item).toMatchObject({ draft: true, ref: { kind: "pr", id: "org/repo/42" } });
    expect(vi.mocked(execGh).mock.calls[0][0]).toContain("repos/org/repo/pulls/42");
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
