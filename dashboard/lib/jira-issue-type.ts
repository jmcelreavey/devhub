export function issueTypeForParent(parentIssueType?: string | null): "Task" | "Sub-task" {
  return parentIssueType?.toLowerCase() === "epic" ? "Task" : "Sub-task";
}
