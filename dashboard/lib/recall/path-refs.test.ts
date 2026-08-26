import { describe, expect, it } from "vitest";
import { refsFromSourcePath } from "./path-refs";

describe("refsFromSourcePath", () => {
  it("resolves a flattened PR slug using the longest known repo name", () => {
    expect(
      refsFromSourcePath("pr-reviews/businessinsider-affiliate-service-286", [
        "service",
        "affiliate-service",
      ]),
    ).toEqual([{ kind: "repo", id: "affiliate-service", label: "affiliate-service" }]);
  });

  it("does not guess a repo from an unmatched PR slug", () => {
    expect(refsFromSourcePath("pr-reviews/businessinsider-affiliate-service-286", ["capi"]))
      .toEqual([]);
  });

  it("derives repo refs from repo-scoped learnings", () => {
    expect(refsFromSourcePath("learnings/insider-app/push-notifications", ["insider-app"]))
      .toEqual([{ kind: "repo", id: "insider-app", label: "insider-app" }]);
  });

  it("requires an exact repo match for learnings", () => {
    expect(refsFromSourcePath("learnings/app/notes", ["insider-app"])).toEqual([]);
  });

  it("derives the task id and date destination from task-note paths", () => {
    expect(refsFromSourcePath("task-notes/2026-08-26-abc-123", [])).toEqual([
      { kind: "task", id: "abc-123", label: "Task abc-123", href: "/work?date=2026-08-26" },
    ]);
  });

  it("derives repo and audit-kind refs from DX audit paths", () => {
    expect(
      refsFromSourcePath("reviews/dx-audit-insider-app-2026-07-14", ["insider-app"]),
    ).toEqual([
      { kind: "repo", id: "insider-app", label: "insider-app" },
      { kind: "tag", id: "dx-audit", label: "#dx-audit", href: "/work?tag=dx-audit" },
    ]);
  });
});
