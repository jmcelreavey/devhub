import { describe, it, expect } from "vitest";
import {
  buildPrNoteMarkdown,
  inferPrReviewEntityRefs,
  prEntityId,
  prEntityRefs,
  prNotePath,
  withPrReviewEntityLinks,
} from "./index.ts";

describe("pr-note", () => {
  it("builds a stable path", () => {
    expect(prNotePath({ repo: "businessinsider/syndication-services", number: 41 })).toBe(
      "pr-reviews/businessinsider-syndication-services-41",
    );
  });

  it("scaffolds with PR EntityRef", () => {
    const md = buildPrNoteMarkdown({
      repo: "org/repo",
      number: 7,
      title: "Fix the thing",
      url: "https://github.com/org/repo/pull/7",
      related: [{ kind: "task", id: "t1", label: "Ship", href: "/work?tab=tasks" }],
    });
    expect(prEntityId({ repo: "org/repo", number: 7 })).toBe("org/repo#7");
    expect(md).toContain("# Fix the thing");
    expect(md).toContain("## Links");
    expect(md).toContain("**PR:** [org/repo#7]");
    expect(md).toContain("**Task:** [Ship](/work?tab=tasks)");
    expect(md).toContain("**Repo:** repo");
  });

  it("links the local repo from GitHub owner/name", () => {
    const refs = prEntityRefs({
      repo: "businessinsider/insider-app",
      number: 12,
      title: "Fix search",
      url: "https://github.com/businessinsider/insider-app/pull/12",
    });
    expect(refs).toEqual([
      {
        kind: "pr",
        id: "businessinsider/insider-app#12",
        label: "businessinsider/insider-app#12",
        href: "https://github.com/businessinsider/insider-app/pull/12",
      },
      { kind: "repo", id: "insider-app", label: "insider-app" },
    ]);
  });

  it("does not duplicate a repo link already in related", () => {
    const refs = prEntityRefs({
      repo: "acme/app",
      number: 1,
      title: "x",
      url: "https://github.com/acme/app/pull/1",
      related: [{ kind: "repo", id: "app", label: "app" }],
    });
    expect(refs.filter((ref) => ref.kind === "repo")).toHaveLength(1);
  });

  it("upserts PR + repo links onto an agent-written review note", () => {
    const md = withPrReviewEntityLinks(`# Fix search

[acme/app#1](https://github.com/acme/app/pull/1)

## Review Findings
- looks fine
`);
    expect(md).toContain("## Links");
    expect(md).toContain("**PR:** [acme/app#1](https://github.com/acme/app/pull/1)");
    expect(md).toContain("**Repo:** app");
    expect(inferPrReviewEntityRefs(md).map((ref) => `${ref.kind}:${ref.id}`)).toEqual([
      "pr:acme/app#1",
      "repo:app",
    ]);
  });
});
