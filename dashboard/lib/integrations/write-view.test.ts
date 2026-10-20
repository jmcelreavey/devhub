import { describe, expect, it } from "vitest";
import { actorName, describeWrite, sourceName } from "./write-view";
import type { WriteProposal } from "./write-types";

const ref = { provider: "jira", account: "default", kind: "issue", id: "PTF-5106" } as const;
const transition: WriteProposal = {
  id: "c3a1f7a4-0b52-4a0e-9f0b-2f2b7b0f5e11", profile: "work", source: "DevHub", state: "pending",
  createdAt: "2026-10-12T09:00:00Z", expiresAt: "2026-10-12T09:15:00Z",
  input: { action: "issue.transition", provider: "jira", account: "default", ref, transitionId: "41" },
  prepared: {
    destination: "https://example.atlassian.net/browse/PTF-5106", actor: "John McElreavey (712020:6f1c2b9e-52a4)", summary: "Move PTF-5106 to Done",
    details: { ticket: "Reconcile entitlements", from: "In Progress", transition: "Done", transitionId: "41", to: "Done" }, native: {},
  },
};

describe("describeWrite", () => {
  it("summarises a transition for a person and keeps ids for the audit", () => {
    const view = describeWrite(transition);
    expect(view.heading).toBe("Move PTF-5106 to Done");
    expect(view.confirmLabel).toBe("Move to Done");
    expect(view.subject).toEqual({ label: "PTF-5106", title: "Reconcile entitlements", url: "https://example.atlassian.net/browse/PTF-5106" });
    expect(view.change).toEqual({ kind: "status", from: "In Progress", to: "Done" });
    expect(view.facts).toEqual([{ label: "Account", value: "John McElreavey · Jira" }, { label: "Requested by", value: "You, in DevHub" }]);
    expect(JSON.stringify(view.facts)).not.toContain("712020");
    expect(view.technical).toEqual(expect.arrayContaining([
      { label: "Transition", value: "Done (id 41)" },
      { label: "Jira account id", value: "712020:6f1c2b9e-52a4" },
      { label: "Request source", value: "DevHub" },
    ]));
  });
  it("still describes a proposal that has not been prepared yet", () => {
    const view = describeWrite({ ...transition, prepared: undefined });
    expect(view.heading).toBe("Move PTF-5106");
    expect(view.change).toBeUndefined();
    expect(view.technical).toContainEqual({ label: "Transition id", value: "41" });
  });
  it("describes PR updates as a before and after title", () => {
    const view = describeWrite({
      ...transition, source: "MCP",
      input: { action: "pr.update", provider: "github", account: "work", ref: { provider: "github", account: "work", kind: "pr", id: "org/repo/42" }, title: "After", body: "New" },
      prepared: { destination: "https://github.com/org/repo/pull/42", actor: "alice (7)", summary: "Update PR #42", details: { previousTitle: "Before", previousBody: "Old", title: "After", body: "New" }, native: {} },
    });
    expect(view.subject).toMatchObject({ label: "org/repo #42", title: "After" });
    expect(view.change).toEqual({ kind: "text", from: "Before", to: "After" });
    expect(view.facts).toContainEqual({ label: "Requested by", value: "An agent through MCP" });
    expect(view.link).toEqual({ label: "Open in GitHub", href: "https://github.com/org/repo/pull/42" });
  });
  it("names the branches of a new PR", () => {
    const view = describeWrite({
      ...transition,
      input: { action: "pr.create", provider: "github", account: "work", repo: "org/repo", head: "feature", base: "main", title: "T", body: "B", draft: true },
      prepared: { destination: "https://github.com/org/repo", actor: "alice (7)", summary: "Create draft pull request", details: { headSha: "a1", baseSha: "b2" }, native: {} },
    });
    expect(view.confirmLabel).toBe("Create draft PR");
    expect(view.change).toEqual({ kind: "branch", from: "feature", to: "main" });
  });
});
describe("actorName and sourceName", () => {
  it("splits a trailing id and leaves anything else alone", () => {
    expect(actorName("Ada Lovelace (abc:123)")).toEqual({ name: "Ada Lovelace", id: "abc:123" });
    expect(actorName("alice")).toEqual({ name: "alice", id: null });
  });
  it("turns chat principals into plain language", () => {
    const source = JSON.stringify([{ provider: "slack", user: "U1", channel: "C1", team: "T1" }, "work"]);
    expect(sourceName(source)).toBe("A Slack chat request");
    expect(sourceName("not json")).toBe("A chat request");
  });
});
