import type { ReactNode } from "react";
import { JiraKeyChip } from "@/components/jira/JiraKeyChip";
import type { JiraTicketRef } from "@/lib/jira/client";

/**
 * One parent's tasks, ruled off with a thin left edge. The header carries the
 * parent once so the rows underneath don't have to repeat it.
 */
export function TaskParentGroup({
  parent,
  count,
  children,
}: {
  parent: JiraTicketRef | null;
  count: number;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={parent ? `Tasks under ${parent.key}` : "Tasks without a parent"}>
      <div className="flex items-center gap-1 px-2 pt-1 text-xs text-text-muted">
        {parent ? (
          <>
            <JiraKeyChip
              quiet
              jiraKey={parent.key}
              label={`Copy parent ticket key ${parent.key}`}
              title={`Copy ${parent.key}`}
            />
            <span className="min-w-0 truncate font-medium" title={parent.summary || undefined}>
              {parent.summary}
            </span>
          </>
        ) : (
          <span className="px-1.5 font-medium">No parent</span>
        )}
        <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] tabular-nums text-text-subtle">{count}</span>
      </div>
      <div className="ml-3 border-l border-border pl-1">{children}</div>
    </div>
  );
}
