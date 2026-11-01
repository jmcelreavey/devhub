export function issueTypeForParent(parentIssueType?: string | null): "Task" | "Sub-task" {
  return parentIssueType?.toLowerCase() === "epic" ? "Task" : "Sub-task";
}

export interface JiraParentCandidate {
  key: string;
  summary?: string;
  issuetype?: string;
  parent?: JiraParentCandidate | null;
}

export function creationParentForLinkedIssue(issue: JiraParentCandidate): JiraParentCandidate {
  return issue.parent ?? issue;
}
