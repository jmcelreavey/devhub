import { describe, expect, it } from "vitest";
import { formatContextPackMarkdown, type ContextPack } from "./context-pack";

describe("formatContextPackMarkdown", () => {
  it("formats tasks and learnings", () => {
    const pack: ContextPack = {
      generatedAt: "2026-06-05T12:00:00.000Z",
      today: "2026-06-05",
      openTasks: [{ id: "1", text: "Ship feature", due: "2026-06-05" }],
      recentLearnings: [{ category: "tools/vim", title: "Vim tips", preview: "use ciw" }],
      dailyNotePath: "daily/2026-06-05",
      dailyNotePreview: "Morning standup",
      standupMarkdown: null,
    };
    const md = formatContextPackMarkdown(pack);
    expect(md).toContain("Ship feature");
    expect(md).toContain("Vim tips");
  });
});
