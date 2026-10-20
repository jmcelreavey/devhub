import type { NextAction } from "./next-action";

export const TASK_DETAIL_SECTIONS = ["revise-plan", "guidance", "logs", "answer", "repo", "plan", "evidence", "activity", "controls", "note"] as const;
export type TaskDetailSection = typeof TASK_DETAIL_SECTIONS[number];

export function taskDetailSection(value: string | null | undefined): TaskDetailSection | undefined {
  return TASK_DETAIL_SECTIONS.find((section) => section === value);
}

export function sectionForTaskAction(action: NextAction | null): TaskDetailSection {
  switch (action?.kind) {
    case "answer": return "answer";
    case "choose-repo": return "repo";
    case "progress":
    case "clear": return "activity";
    case "retry":
    case "auto-retry":
    case "review":
    case "review-proposal": return "evidence";
    case "finish":
    case "done": return "controls";
    default: return "plan";
  }
}

export function taskDetailHref(pathname: string, search: string, taskId: string, section?: TaskDetailSection, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete("pr");
  params.set("task", taskId);
  if (section) params.set("taskSection", section);
  else params.delete("taskSection");
  return `${pathname}?${params.toString()}${hash}`;
}
