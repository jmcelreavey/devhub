import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/gh-exec", () => ({ execGh: vi.fn(), githubCliErrorInfo: () => ({ kind: "other" }) }));
vi.mock("@/lib/jira/client", () => ({ getJiraMeta: vi.fn(async () => ({ sprintFieldId: "custom_sprint", teamFieldId: "custom_team", teamValue: { id: "team-7" }, teamLabel: "Platform" })), invalidateJiraMetaCache: vi.fn(), markdownToADF: (text: string) => ({ type: "doc", text }), normalizeTeamValueForWrite: (value: { id: string }) => value.id }));
vi.mock("@/lib/jira/env", () => ({ getResolvedJiraEnv: () => ({ domain: "example.atlassian.net", email: "user@example.test", apiToken: "secret" }), apiBase: () => "https://example.atlassian.net/rest/api/3", jsonHeaders: () => ({ Authorization: "test" }) }));
vi.mock("@/lib/jira/tickets-cache", () => ({ invalidateJiraTicketsCache: vi.fn() }));
vi.mock("@/lib/sidebar-counts-cache", () => ({ invalidateSidebarCountsCache: vi.fn() }));
vi.mock("./accounts", () => ({ accountsFor: () => [], accountConfig: () => ({ tokenRef: "TOKEN", domain: "example.atlassian.net", emailRef: "EMAIL" }), credential: (ref: string) => ref }));
import { jiraProvider, clearJiraTransitionCache } from "./jira";
import { clearJiraActorCache } from "./jira-write";
import { githubProvider } from "./github";
import { clearGithubUserCache } from "./github-write";
import { execGh } from "@/lib/gh-exec";
import { WriteInputSchema } from "./write-types";
const signal = new AbortController().signal;
const context = { signal, approvalId: "approved-id" };
const mockedFetch = vi.fn();
beforeEach(() => { vi.clearAllMocks(); mockedFetch.mockReset(); clearJiraActorCache(); clearJiraTransitionCache(); clearGithubUserCache(); vi.stubGlobal("fetch", mockedFetch); });
afterEach(() => vi.unstubAllGlobals());
describe("native provider write payloads", () => {
  it("assigns a picked-up ticket to the receiver's authenticated Jira account", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json({ accountId: "receiver-account", displayName: "Receiver" }));
    const input = WriteInputSchema.parse({ action: "issue.assign-self", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" } });
    const prepared = await jiraProvider.prepareWrite!(input, context);
    expect(prepared.native.payload).toEqual({ accountId: "receiver-account" });
    mockedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await jiraProvider.executeWrite!(input, prepared, context);
    expect(String(mockedFetch.mock.calls.at(-1)![0])).toContain("/issue/APP-1/assignee");
    expect(mockedFetch.mock.calls.at(-1)![1]).toMatchObject({ method: "PUT", body: JSON.stringify({ accountId: "receiver-account" }) });
  });
  it("preserves default Jira parent, assignee, team and sprint and sends the reviewed fields", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json({ accountId: "a1", displayName: "Alice" }))
      .mockResolvedValueOnce(Response.json({ fields: { issuetype: { name: "Epic" }, updated: "parent-v1" } }));
    const input = WriteInputSchema.parse({ action: "issue.create", provider: "jira", account: "default", projectKey: "APP", title: "A ticket", body: "Description", parentKey: "APP-1", sprintId: 42 });
    const prepared = await jiraProvider.prepareWrite!(input, context);
    expect(mockedFetch.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
    expect(prepared.native.payload).toEqual({ fields: { project: { key: "APP" }, issuetype: { name: "Task" }, summary: "A ticket", description: { type: "doc", text: "Description" }, parent: { key: "APP-1" }, assignee: { accountId: "a1" }, custom_sprint: 42, custom_team: "team-7" } });
    mockedFetch.mockResolvedValueOnce(Response.json({ key: "APP-2" }));
    expect((await jiraProvider.executeWrite!(input, prepared, context)).item?.ref.id).toBe("APP-2");
    expect(JSON.parse(mockedFetch.mock.calls.at(-1)![1].body)).toEqual(prepared.native.payload);
  });
  it("keeps native transition labels and accepts Jira's empty 204 response", async () => {
    mockedFetch.mockResolvedValueOnce(Response.json({ accountId: "a1", displayName: "Alice" }))
      .mockResolvedValueOnce(Response.json({ fields: { summary: "Ticket", updated: "v1", status: { id: "1", name: "Open" } }, transitions: [{ id: "31", name: "Resolve", to: { id: "10", name: "Done" } }] }));
    const input = WriteInputSchema.parse({ action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "APP-1" }, transitionId: "31" });
    const prepared = await jiraProvider.prepareWrite!(input, context);
    expect(prepared.details).toMatchObject({ from: "Open", transition: "Resolve", to: "Done", key: "APP-1", fromStatusId: "1", toStatusId: "10" });
    // Actor plus one issue read that carries the transitions: two requests, not three.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(String(mockedFetch.mock.calls[1][0])).toContain("expand=transitions");
    mockedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await jiraProvider.executeWrite!(input, prepared, context)).detail).toBe("Move APP-1 to Done");
  });
  it("asks who the Jira account is once, and lists transitions once until a write changes them", async () => {
    const ref = { provider: "jira", account: "default", kind: "issue", id: "APP-1" } as const;
    const issue = (status: string) => Response.json({ fields: { summary: "Ticket", updated: "v1", status: { id: "1", name: status } }, transitions: [{ id: "31", name: "Resolve", to: { id: "10", name: "Done" } }] });
    const input = WriteInputSchema.parse({ action: "issue.transition", provider: "jira", account: "default", ref, transitionId: "31" });
    mockedFetch.mockResolvedValueOnce(Response.json({ accountId: "a1", displayName: "Alice" })).mockResolvedValueOnce(issue("Open")).mockResolvedValueOnce(issue("Open"));
    await jiraProvider.prepareWrite!(input, context);
    await jiraProvider.prepareWrite!(input, context);
    expect(mockedFetch.mock.calls.filter(([url]) => String(url).endsWith("/myself"))).toHaveLength(1);
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValueOnce(Response.json({ transitions: [{ id: "31", name: "Resolve", to: { id: "10", name: "Done" } }] }));
    await jiraProvider.transitions!(ref, context);
    await jiraProvider.transitions!(ref, context);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const prepared = { destination: "x", actor: "Alice (a1)", summary: "Move APP-1 to Done", details: {}, native: { payload: { transition: { id: "31" } } } };
    mockedFetch.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(Response.json({ transitions: [] }));
    await jiraProvider.executeWrite!(input, prepared, context);
    expect(await jiraProvider.transitions!(ref, context)).toEqual([]);
  });
  it("creates PRs through gh stdin with reviewed branch SHAs and a draft default", async () => {
    vi.mocked(execGh).mockResolvedValueOnce({ stdout: '{"login":"alice","id":7}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '{"commit":{"sha":"head"}}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '{"commit":{"sha":"base"}}', stderr: "" })
      .mockResolvedValueOnce({ stdout: '[]', stderr: "" });
    const input = WriteInputSchema.parse({ action: "pr.create", provider: "github", account: "default", repo: "org/repo", head: "feature", base: "main", title: "Title with \"quotes\"", body: "Line one\nLine two" });
    const prepared = await githubProvider.prepareWrite!(input, context);
    expect(prepared.native).toMatchObject({ headSha: "head", baseSha: "base", payload: { draft: true } });
    vi.mocked(execGh).mockResolvedValueOnce({ stdout: '{"number":42,"html_url":"https://github.com/org/repo/pull/42","title":"Title"}', stderr: "" });
    await githubProvider.executeWrite!(input, prepared, context);
    const [args, opts] = vi.mocked(execGh).mock.calls.at(-1)!;
    expect(args).toEqual(["api", "--method", "POST", "repos/org/repo/pulls", "--input", "-"]);
    expect(JSON.parse(opts!.input!)).toEqual(prepared.native.payload);
  });
  it("publishes only a draft PR with the reviewed node ID", async () => {
    const pr = { number: 42, node_id: "PR_1", title: "Ready", body: "", html_url: "https://github.com/org/repo/pull/42", state: "open", draft: true, updated_at: "v1", head: { sha: "head", ref: "feature" }, base: { sha: "base", ref: "main" } };
    mockedFetch.mockResolvedValueOnce(Response.json({ login: "alice", id: 7 })).mockResolvedValueOnce(Response.json(pr));
    const input = WriteInputSchema.parse({ action: "pr.publish", provider: "github", account: "work", ref: { provider: "github", account: "work", kind: "pr", id: "org/repo/42" } });
    const prepared = await githubProvider.prepareWrite!(input, context);
    mockedFetch.mockResolvedValueOnce(Response.json({ data: { markPullRequestReadyForReview: { pullRequest: { url: pr.html_url } } } }));
    expect((await githubProvider.executeWrite!(input, prepared, context)).item?.url).toBe(pr.html_url);
    expect(JSON.parse(mockedFetch.mock.calls.at(-1)![1].body).variables).toEqual({ id: "PR_1" });
    // The signed-in user is cached, so the second preparation only re-reads the PR.
    mockedFetch.mockResolvedValueOnce(Response.json({ ...pr, draft: false }));
    await expect(githubProvider.prepareWrite!(input, context)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("previews both versions before a named-account PR update", async () => {
    const pr = { number: 42, node_id: "PR_1", title: "Before", body: "Old body", html_url: "https://github.com/org/repo/pull/42", state: "open", draft: true, updated_at: "v1", head: { sha: "head", ref: "feature" }, base: { sha: "base", ref: "main" } };
    mockedFetch.mockResolvedValueOnce(Response.json({ login: "alice", id: 7 })).mockResolvedValueOnce(Response.json(pr));
    const input = WriteInputSchema.parse({ action: "pr.update", provider: "github", account: "work", ref: { provider: "github", account: "work", kind: "pr", id: "org/repo/42" }, title: "After", body: "New body" });
    const prepared = await githubProvider.prepareWrite!(input, context);
    expect(prepared.details).toEqual({ previousTitle: "Before", previousBody: "Old body", title: "After", body: "New body" });
    mockedFetch.mockResolvedValueOnce(Response.json(pr));
    await githubProvider.executeWrite!(input, prepared, context);
    expect(mockedFetch.mock.calls.at(-1)![1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ title: "After", body: "New body" }) });
  });
});
