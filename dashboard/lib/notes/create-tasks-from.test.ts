import { blocksToText } from "@/lib/markdown-convert";
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

describe("parsePlanWorkItems toggle lists", () => {
  const shot = (n: number) => `![](/api/notes-media/${String(n).repeat(64)}.png)`;

  it("offers each toggle as a work item with its body and images", () => {
    const items = parsePlanWorkItems(`# Android testing
## Issues
::toggle Android Tablet: Continue with should say Google
${shot(1)}
::end-toggle
::toggle Android Tablet: Follow needs padding
Seen on the article page.
${shot(2)}
${shot(3)}
::end-toggle
`);
    expect(items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    expect(items[0]?.summary).toBe("Android Tablet: Continue with should say Google");
    expect(items[0]?.images).toEqual([`/api/notes-media/${"1".repeat(64)}.png`]);
    expect(items[1]?.description).toContain("Seen on the article page.");
    expect(items[1]?.images).toHaveLength(2);
    expect(items[1]?.description).not.toContain("::");
  });

  it("keeps nested toggles inside their parent item", () => {
    const items = parsePlanWorkItems(`## Issues
::toggle Login broken
Fails on tablets.
::toggle Repro steps
Open the app.
${shot(4)}
::end-toggle
::end-toggle
::toggle Second issue
::end-toggle
`);
    expect(items.map((item) => item.summary)).toEqual(["Login broken", "Second issue"]);
    expect(items[0]?.description).toContain("**Repro steps**");
    expect(items[0]?.description).toContain("Open the app.");
    expect(items[0]?.images).toEqual([`/api/notes-media/${"4".repeat(64)}.png`]);
    expect(items[0]?.description).not.toContain("::");
  });

  it("treats a toggle that only holds toggles as a group of items", () => {
    const items = parsePlanWorkItems(`## Issues
::toggle Android Tablet
::toggle Follow needs padding
${shot(5)}
::end-toggle
::toggle Minutes to read alignment
::end-toggle
::end-toggle
`);
    expect(items.map((item) => item.summary)).toEqual([
      "Android Tablet: Follow needs padding",
      "Android Tablet: Minutes to read alignment",
    ]);
    expect(items[0]?.images).toHaveLength(1);
  });

  it("mixes toggles with numbered and bulleted items in document order", () => {
    const items = parsePlanWorkItems(`## Issues
1. Accept privacy is needed twice
2. MFA placeholder logo
::toggle Tablet: Continue with should say Google
${shot(6)}
::end-toggle
- Rate prompt does nothing
  ::toggle Details inside a bullet
  ${shot(7)}
  ::end-toggle
::toggle Tablet: Follow needs padding
::end-toggle
`);
    expect(items.map((item) => item.summary)).toEqual([
      "Accept privacy is needed twice",
      "MFA placeholder logo",
      "Tablet: Continue with should say Google",
      "Rate prompt does nothing",
      "Tablet: Follow needs padding",
    ]);
    expect(items[2]?.images).toHaveLength(1);
    // A toggle indented under a bullet belongs to that bullet.
    expect(items[3]?.description).toContain("**Details inside a bullet**");
    expect(items[3]?.images).toHaveLength(1);
  });

  it("ignores toggles under Links and inside code fences", () => {
    const items = parsePlanWorkItems(`## Links
::toggle Reference
::end-toggle
## Issues
::toggle Real issue
\`\`\`text
::end-toggle
\`\`\`
still the same issue
::end-toggle
`);
    expect(items.map((item) => item.summary)).toEqual(["Real issue"]);
    expect(items[0]?.description).toContain("still the same issue");
  });

  it("falls back to the first text line for an untitled toggle and skips empty ones", () => {
    const items = parsePlanWorkItems(`## Issues
::toggle
Logo is cropped
::end-toggle
::toggle
::end-toggle
`);
    expect(items.map((item) => item.summary)).toEqual(["Logo is cropped"]);
  });

  it("parses a real BlockNote tree: numbered issues then image toggles", () => {
    const text = (type: string, value: string, children: unknown[] = []) => ({
      type, props: {}, content: [{ type: "text", text: value, styles: {} }], children,
    });
    const url = `/api/notes-media/${"c".repeat(64)}.png`;
    const markdown = blocksToText([
      text("heading", "Issues"),
      text("numberedListItem", "Privacy prompt twice"),
      text("toggleListItem", "Android Tablet: Continue with should say Google", [
        { type: "image", props: { url, caption: "" }, children: [] },
        text("paragraph", ""),
      ]),
    ]);
    const items = parsePlanWorkItems(markdown);
    expect(items.map((item) => item.summary)).toEqual([
      "Privacy prompt twice",
      "Android Tablet: Continue with should say Google",
    ]);
    expect(items[1]?.images).toEqual([url]);
  });

  it("collects images from plain bullet items too", () => {
    const items = parsePlanWorkItems(`## Issues
- Splash cropped
  ![](garden/splash.png)
`);
    expect(items[0]?.images).toEqual(["garden/splash.png"]);
  });
});

describe("planTitleFromMarkdown", () => {
  it("uses first h1", () => {
    expect(planTitleFromMarkdown("# Sample project analytics\n\nbody", "projects/x")).toBe(
      "Sample project analytics",
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
  it("keeps the parent out of child task keys and binds pending proposals to existing tasks", () => {
    const prompt = buildCreateTasksFromPrompt({ origin: "http://localhost:1342", notePath: "task-notes/testing", parentKey: "PTF-4891" });
    expect(prompt).toContain("context only");
    expect(prompt).toContain("without a Jira key or key prefix");
    expect(prompt).toContain("issue.create, parentKey and that taskId");
    expect(prompt).toContain("Do not create a second task");
    expect(prompt).toContain("Pass parentKey to tasks_create");
  });
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

  it("keeps nested content and image links in the reviewed launch payload", () => {
    const image = `/api/notes-media/${"d".repeat(64)}.png`;
    const workItems = [{
      id: "item-1",
      title: "Android Tablet",
      summary: "Android Tablet: Continue with should say Google",
      description: `Android Tablet\n**Reproduction**\nContinue with wraps.\n![](${image})`,
      images: [image],
    }];
    const prompt = buildCreateTasksFromPrompt({
      origin: "http://localhost:1342",
      notePath: "task-notes/android-testing",
      workItems,
    });
    expect(prompt).toContain(JSON.stringify(workItems, null, 2));
    expect(prompt).toContain("copy the description into the DevHub task note unchanged");
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
