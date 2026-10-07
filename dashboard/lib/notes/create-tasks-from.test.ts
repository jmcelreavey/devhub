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

  it("extracts issue bullets and skips note links and empty checklist placeholders", () => {
    const items = parsePlanWorkItems(`# Android testing
## Links
- [Task](/work?task=test)
### Related
- [Repo](/repos/app)
## Issues Found
- Splash icon is cropped
- App crashes while scrolling
- Feedback screen is blank
-
## Action items
- [ ]
`);
    expect(items.map((item) => item.summary)).toEqual([
      "Splash icon is cropped",
      "App crashes while scrolling",
      "Feedback screen is blank",
    ]);
    expect(items[0]).toMatchObject({
      id: "item-1",
      description: "Splash icon is cropped",
    });
    expect(items.every((item) => item.repoHint === undefined)).toBe(true);
  });

  it("keeps nested details with their issue and ignores completed items and code examples", () => {
    const items = parsePlanWorkItems(`# Test plan
## Issues
1. [ ] Fix startup crash
   Happens after signing in.
   - Reopen the app to reproduce.
2. [x] Already fixed
3. Fix feedback
\`\`\`text
- Example, not an issue
\`\`\`
## Context
Unrelated prose.
`);
    expect(items.map((item) => item.summary)).toEqual(["Fix startup crash", "Fix feedback"]);
    expect(items[0]?.description).toContain("Reopen the app to reproduce.");
    expect(items[1]?.description).not.toContain("Unrelated prose.");
  });

  it("prefers explicit PR sections over lists within them", () => {
    const items = parsePlanWorkItems("## PR 1 — App: fix startup\n- Add regression coverage");
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("pr-1");
  });

  it("returns empty when there are no work items", () => {
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
  it("makes the reviewed selection authoritative and preserves the chosen title", () => {
    const workItems = [{
      id: "item-2",
      title: "feedback blank",
      summary: "Send feedback opens a blank screen",
      description: "Original reproduction details.",
    }];
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1342",
      notePath: "task-notes/android-testing",
      workItems,
    });
    expect(prompt).toContain(JSON.stringify(workItems, null, 2));
    expect(prompt).toContain("This list overrides workItems from the plan URL");
    expect(prompt).toContain("using each summary exactly as the ticket title");
    expect(prompt).toContain("restore omitted items");
    expect(prompt).not.toContain("derive them from the note");
  });

  it("does not derive new tickets when the reviewed selection is empty", () => {
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1342",
      notePath: "task-notes/android-testing",
      workItems: [],
    });
    expect(prompt).toContain("create nothing, including no parent ticket");
    expect(prompt).toContain("Reviewed work items (JSON):\n[]");
    expect(prompt).not.toContain("derive them from the note");
  });

  it("passes a new parent title and user instructions to the agent", () => {
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1342",
      notePath: "task-notes/android-testing",
      epicSummary: "Android Self Testing Round",
      instructions: "One child ticket per issue. Keep reproduction details.",
    });
    expect(prompt).toContain("No parent Jira key");
    expect(prompt).toContain("Parent summary override: Android Self Testing Round");
    expect(prompt).toContain("User instructions: One child ticket per issue. Keep reproduction details.");
    expect(prompt).toContain("PR headings are not required");
  });

  it("names the skill and plan URL", () => {
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1337",
      notePath: "projects/plan",
      parentKey: "PTF-1",
    });
    expect(prompt).toContain("devhub-create-tasks-from");
    expect(prompt).toContain("my-voice skill in full-voice mode");
    expect(prompt).toContain("PTF-1");
    expect(prompt).toContain("/api/notes/create-tasks/plan?");
  });
});
