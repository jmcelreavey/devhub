import { describe, expect, it } from "vitest";
import {
  buildCreateTasksFromPrompt,
  createTasksPlanUrl,
  parsePlanWorkItems,
  planTitleFromMarkdown,
} from "./create-tasks-from";

describe("parsePlanWorkItems", () => {
  it("extracts PR sections with bodies", () => {
    const md = `# Analytics plan

Intro.

## PR 1 — WebApp: signup module events

Emit page views on /analytics.

## PR 2 — ApiService: attribution pipeline

Wire digest events.
`;
    const items = parsePlanWorkItems(md);
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("pr-1");
    expect(items[0]?.repoHint).toBe("WebApp");
    expect(items[0]?.description).toContain("Emit page views");
    expect(items[1]?.summary).toContain("ApiService");
  });

  it("returns empty when no PR headings", () => {
    expect(parsePlanWorkItems("# Plan\n\nJust prose.")).toEqual([]);
  });
});

describe("planTitleFromMarkdown", () => {
  it("uses first h1", () => {
    expect(planTitleFromMarkdown("# BI Job Scout analytics\n\nbody", "projects/x")).toBe(
      "BI Job Scout analytics",
    );
  });
});

describe("createTasksPlanUrl", () => {
  it("encodes note path and options", () => {
    expect(
      createTasksPlanUrl({
        origin: "http://localhost:1337",
        notePath: "projects/product-analytics-plan",
        parentKey: "PTF-4484",
        repos: ["acme-api", "acme-web"],
      }),
    ).toBe(
      "http://localhost:1337/api/notes/create-tasks/plan?notePath=projects%2Fproduct-analytics-plan&parentKey=PTF-4484&repo=acme-api&repo=acme-web",
    );
  });
});

describe("buildCreateTasksFromPrompt", () => {
  it("names the skill and plan URL", () => {
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1337",
      notePath: "projects/plan",
      parentKey: "PTF-1",
    });
    expect(prompt).toContain("devhub-create-tasks-from");
    expect(prompt).toContain("PTF-1");
    expect(prompt).toContain("/api/notes/create-tasks/plan?");
  });
});
