import type { ContextMenuGroup } from "@/components/shell/ContextMenu";

// Keep caller-supplied completion, PR and Jira actions in the same sections as the shared items.
const TASK_MENU_SECTIONS = [
  { id: "task", label: "Task", items: ["complete", "complete-merged", "reopen", "reopen-feedback", "follow-up", "reactivate", "edit", "add-note", "note", "open", "timer", "upstart"] },
  { id: "agent", label: "Agent", items: ["plan-agent", "mark-ready", "implement-agent", "start-auto", "start-auto-without-review", "start-auto-tiers", "resume-agent", "auto-mode", "mark-draft"] },
  { id: "recovery", label: "Recovery", items: ["failure-retry", "failure-guidance", "failure-logs", "failure-clear"] },
  { id: "review", label: "Review", items: ["workflow", "copy-plan", "storyboard", "copy-slack", "dismiss-attention"] },
  { id: "jira", label: "Jira", items: ["open-jira", "generate-jira", "jira", "update-jira-status"] },
  { id: "danger", items: ["abandon-closed", "abandon", "delete"] },
];

export function groupTaskMenu(groups: ContextMenuGroup[]): ContextMenuGroup[] {
  const items = groups.flatMap((group) => group.items);
  const knownIds = new Set(TASK_MENU_SECTIONS.flatMap((section) => section.items));
  const sections = TASK_MENU_SECTIONS.map((section) => ({
    ...section,
    items: section.items.flatMap((id) => items.filter((item) => item.id === id)),
  }));
  const otherGroups = groups.map((group) => ({
    ...group,
    id: TASK_MENU_SECTIONS.some((section) => section.id === group.id) ? `${group.id}-extra` : group.id,
    items: group.items.filter((item) => !knownIds.has(item.id)),
  }));
  return [...sections.slice(0, -1), ...otherGroups, sections[sections.length - 1]]
    .filter((group) => group.items.length > 0);
}

