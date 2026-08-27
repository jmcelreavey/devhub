import { describe, expect, it } from "vitest";
import { commonTaskRefs } from "./hub-chips";
import type { EntityRef } from "../entity-note";

const plan: EntityRef = { kind: "note", id: "projects/webview-plan", label: "WebView plan" };
const other: EntityRef = { kind: "note", id: "projects/other", label: "Other" };
const repo: EntityRef = { kind: "repo", id: "app-poc", label: "app-poc" };

describe("commonTaskRefs", () => {
  it("hoists a link every row carries", () => {
    const refs = commonTaskRefs([{ links: [plan] }, { links: [plan] }, { links: [plan] }]);
    expect(refs.map((ref) => ref.id)).toEqual(["projects/webview-plan"]);
  });

  it("leaves a link only some rows carry on the rows", () => {
    const refs = commonTaskRefs([{ links: [plan, other] }, { links: [plan] }]);
    expect(refs.map((ref) => ref.id)).toEqual(["projects/webview-plan"]);
  });

  it("does not hoist the repo chip already suppressed on its own page", () => {
    const refs = commonTaskRefs([{ links: [repo, plan] }, { links: [repo, plan] }], {
      repoName: "app-poc",
    });
    expect(refs.map((ref) => ref.kind)).toEqual(["note"]);
  });

  it("hoists nothing for a single row", () => {
    expect(commonTaskRefs([{ links: [plan] }])).toEqual([]);
  });

  it("hoists nothing when a row has no links at all", () => {
    expect(commonTaskRefs([{ links: [plan] }, {}])).toEqual([]);
  });
});
