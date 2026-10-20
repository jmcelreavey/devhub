// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { applyTaskNoteOp, parseTaskNoteOp, readTaskNote } from "@shared/task-note/sections.ts";
import { textToBlocks } from "@shared/markdown-convert/index.ts";
import { buildTaskNoteMarkdown } from "@shared/task-note/index.ts";
import { dedupePillLinks, pillText } from "./pill-links";

vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { tasks: [{ id: "t1", done: true }] } }) }));

import { TaskNoteVisual } from "./TaskNoteVisual";

function noteWith(ops: Array<Record<string, unknown>>) {
  let blocks = textToBlocks(buildTaskNoteMarkdown({ id: "t1", text: "Second stage", date: "2026-10-16" })) as unknown[];
  for (const raw of ops) {
    const parsed = parseTaskNoteOp(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    blocks = applyTaskNoteOp(blocks, parsed.op).blocks;
  }
  return readTaskNote(blocks);
}

describe("pill links", () => {
  it("shows PRs as repo#number and drops duplicates of the same destination", () => {
    const links = [
      { kind: "jira", id: "PTF-5195", label: "PTF-5195", href: "https://x.atlassian.net/browse/PTF-5195" },
      { kind: "pr", id: "a", label: "PTF-5195 — Version 17 store testing", href: "https://github.com/bi/app/pull/181" },
      { kind: "pr", id: "b", label: "PTF-5195 — Version 17 store testing", href: "https://github.com/bi/app/pull/181/" },
      { kind: "note", id: "c", label: "PTF-5195 — App release environments" },
    ];
    const out = dedupePillLinks(links);
    expect(out.map(pillText)).toEqual(["PTF-5195", "app#181", "App release environments"]);
  });
});

describe("TaskNoteVisual", () => {
  it("shows the agent-set status even when the task is done, and renders sections", () => {
    const view = noteWith([
      { op: "set_status", status: "draft-pr", text: "PR open" },
      { op: "set_summary", text: "Adds the first vow room." },
      { op: "add_bug", title: "Wall clip", severity: "blocking" },
    ]);
    render(<TaskNoteVisual view={view} sourceMode={false} onToggleSource={() => {}} onOp={() => {}} />);
    const status = document.querySelector('[data-pill="status"]');
    expect(status?.textContent?.toLowerCase()).toContain("draft");
    expect(screen.getByText("Adds the first vow room.")).toBeTruthy();
    expect(screen.getByText("blocker")).toBeTruthy();
  });

  it("renders a 'Tags: #a #b' summary line as tag pills and leaves other prose alone", () => {
    const view = noteWith([{ op: "set_summary", text: "Tags: #alpha #beta-two" }]);
    render(<TaskNoteVisual view={view} sourceMode={false} onToggleSource={() => {}} onOp={() => {}} />);
    const line = document.querySelector("[data-tag-line]");
    expect(line?.textContent).toBe("Tags:#alpha#beta-two");
    const hrefs = [...(line?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/work?tab=tasks&tag=alpha", "/work?tab=tasks&tag=beta-two"]);
  });

  it("keeps a prose line that merely mentions tags as plain text", () => {
    const view = noteWith([{ op: "set_summary", text: "Tags: #alpha are great" }]);
    render(<TaskNoteVisual view={view} sourceMode={false} onToggleSource={() => {}} onOp={() => {}} />);
    expect(document.querySelector("[data-tag-line]")).toBeNull();
    expect(screen.getByText("Tags: #alpha are great")).toBeTruthy();
  });

  it("makes every header pill clickable: status picker, tags, links, models", () => {
    const onOp = vi.fn();
    const view = noteWith([
      { op: "set_status", status: "in-progress" },
      { op: "set_meta", tags: ["auth"], models: ["sonnet"], links: [
        { kind: "jira", id: "PTF-1", label: "PTF-1" },
        { kind: "pr", id: "p", label: "PR", href: "https://github.com/bi/app/pull/9" },
        { kind: "note", id: "n1", label: "Design notes" },
      ] },
    ]);
    render(<TaskNoteVisual view={view} sourceMode={false} onToggleSource={() => {}} onOp={onOp} />);
    const status = screen.getByLabelText("Task status") as HTMLSelectElement;
    expect(status.value).toBe("in-progress");
    fireEvent.change(status, { target: { value: "blocked" } });
    expect(onOp).toHaveBeenCalledWith({ op: "set_status", status: "blocked" });
    const pills = document.querySelector('[aria-label="Task details"]')!;
    const hrefs = [...pills.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/work?tab=tasks&tag=auth");
    expect(hrefs).toContain("https://github.com/bi/app/pull/9");
    expect(hrefs.some((href) => href?.includes("PTF-1"))).toBe(true);
    expect(hrefs).toContain("/storyboard?settings=model-tiers");
    // No plain-span pills left in the header row.
    expect([...pills.children].filter((el) => el.tagName === "SPAN")).toHaveLength(0);
  });
});
