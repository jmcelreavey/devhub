"use client";

import { openNoteHrefInPanel } from "@/lib/notes/open-in-panel";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCheck, FileText, LayoutGrid, Mail, MailOpen, X } from "lucide-react";
import { ContextMenu, useContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useTaskAgentActions } from "@/components/tasks/useTaskAgentActions";
import { groupTaskMenu } from "@/components/tasks/taskMenuGroups";
import { requestNotifyPermission } from "@/lib/desktop/bridge";
import { vaultNoteHref } from "@/lib/create-vault-note";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { taskNotePath } from "@/lib/task-note";
import { isUnread, setInboxRead, WORKFLOW_INBOX_KEY, type WorkflowInboxItem, type WorkflowInboxResponse } from "@/lib/workflows/inbox";
import { workflowUpdates } from "@/lib/storyboard/work-summary";
import styles from "./WorkflowInboxPanel.module.css";

/** Enough to scan at a glance; the rest are one click away, so the drawer never grows without bound. */
export const INBOX_PAGE = 20;

export function useWorkflowInbox() {
  return useLive<WorkflowInboxResponse>(WORKFLOW_INBOX_KEY, { refreshInterval: 15000 });
}

const workflowHref = (taskId: string) => "/workflow?taskId=" + encodeURIComponent(taskId);

async function patchTask(body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response.ok;
}

/**
 * The right-click menu for one inbox item: the same task actions a task row
 * offers (via the shared hook), plus read state and where to open it.
 * Mounted only while open, so idle rows don't each poll for agent runs.
 */
function InboxItemMenu({ item, position, onClose, onOpenCard, onChanged }: {
  item: WorkflowInboxItem;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenCard: (taskId: string) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { task, workflow } = item;
  const date = task.date ?? task.startDate;
  const agent = useTaskAgentActions({
    task, date, enabled: true,
    onComplete: () => void patchTask({ id: task.id, date, completion: true }).then((ok) => { if (ok) { toast.success("Task completed"); onChanged(); } else toast.error("Couldn't complete the task"); }),
    onAbandon: (reason) => void patchTask({ id: task.id, status: "abandoned", abandonReason: reason }).then((ok) => { if (ok) { toast.success("Task abandoned"); onChanged(); } else toast.error("Couldn't abandon the task"); }),
  });
  const unread = isUnread(workflow);
  let noteHref: string | null = null;
  try { noteHref = vaultNoteHref(taskNotePath({ ...task, date })); } catch { noteHref = null; }
  const groups: ContextMenuGroup[] = [
    {
      id: "inbox",
      label: "Open",
      items: [
        { id: "open-card", label: "Open card", icon: <LayoutGrid size={12} aria-hidden />, onSelect: () => onOpenCard(task.id) },
        { id: "open-workflow", label: "Open workflow", description: "Checks, reviews and decisions", icon: <ArrowUpRight size={12} aria-hidden />, onSelect: () => router.push(workflowHref(task.id)) },
        { id: "open-note", label: "Open note", icon: <FileText size={12} aria-hidden />, disabled: !noteHref, onSelect: () => { if (noteHref && !openNoteHrefInPanel(noteHref)) router.push(noteHref); } },
      ],
    },
    {
      id: "read-state", label: "Read state",
      items: [{
          id: "read", label: unread ? "Mark read" : "Mark unread", icon: unread ? <MailOpen size={12} aria-hidden /> : <Mail size={12} aria-hidden />,
          onSelect: () => void setInboxRead(item, unread).then((ok) => { if (!ok) toast.error("That workflow just changed. Try again."); onChanged(); }),
        }],
    },
    // The shared task menu, minus its own workflow and Storyboard links (already above).
    ...groupTaskMenu([{ id: "task", items: agent.menuItems.filter((entry) => entry.id !== "workflow" && entry.id !== "storyboard") }]),
  ];
  return <>
    <ContextMenu open position={position} groups={groups} onClose={onClose} label={`Update actions for ${task.text}`} />
    {agent.dialogs}
  </>;
}

/**
 * Workflow updates (checks, reviews, approvals) as a drawer on the Storyboard.
 * One action per row: open its card on the board. Everything else is on
 * right-click, and the full evidence is on the workflow page.
 */
export function WorkflowInboxPanel({ onClose, onOpenCard }: { onClose: () => void; onOpenCard: (taskId: string) => void }) {
  const { data, error, mutate } = useWorkflowInbox();
  const toast = useToast();
  const menu = useContextMenu<WorkflowInboxItem>();
  const [limit, setLimit] = useState(INBOX_PAGE);
  const [marking, setMarking] = useState(false);
  const [permission, setPermission] = useState("");
  const [showRead, setShowRead] = useState(false);
  const updates = workflowUpdates(data?.items ?? []);
  const unread = updates.filter((update) => update.unread);
  const visible = showRead ? updates : unread;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !menu.target) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu.target, onClose]);

  const openCard = (item: WorkflowInboxItem) => {
    onOpenCard(item.task.id);
    if (isUnread(item.workflow)) void setInboxRead(item, true).then((ok) => {
      if (!ok) toast.error("That workflow just changed. Refresh before marking it read.");
      void mutate();
    }).catch(() => toast.error("Couldn't mark this update read."));
  };

  const markAllRead = async () => {
    setMarking(true);
    try {
      const items = [...new Map(unread.map((update) => [update.item.task.id, update.item])).values()];
      const results = await Promise.all(items.map((item) => setInboxRead(item, true)));
      const failed = results.filter((ok) => !ok).length;
      if (failed) toast.error(`${failed} changed while marking. Try again.`);
      else toast.success(`Marked ${results.length} read`);
      await mutate();
    } catch {
      toast.error("Couldn't mark updates read. Refresh before trying again.");
      void mutate();
    } finally {
      setMarking(false);
    }
  };

  return (
    <aside id="workflow-inbox" className={styles.panel} aria-label="Updates">
      <div className={styles.head}>
        <h2>Updates{unread.length ? <span className={styles.count}>{unread.length} unread</span> : null}</h2>
        <button type="button" className="btn btn-ghost" disabled={!unread.length || marking} onClick={() => void markAllRead()}>
          <CheckCheck size={13} aria-hidden />Mark all read
        </button>
        <button type="button" className={styles.close} aria-label="Close updates" title="Close (Esc)" onClick={onClose}><X size={15} aria-hidden /></button>
      </div>
      <p className={styles.hint}>Reading updates doesn&apos;t resolve questions, failures or decisions in Needs you.</p>
      {error ? <FetchError message={error.message} onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={4} /> : visible.length === 0 ? (
        <div className={styles.empty}><strong>{showRead ? "Nothing here yet" : "No unread updates"}</strong>Informational updates from tasks you plan or build show up here.</div>
      ) : (
        <ul className={styles.list}>
          {visible.slice(0, limit).map(({ item, event, unread: isNew }) => (
            <li key={`${item.task.id}-${event.id}`} className={styles.row} data-unread={isNew ? "" : undefined} {...menu.bindRow(item)}>
              <button type="button" className={styles.open} onClick={() => openCard(item)} title="Open its card on the board">
                <span className={styles.title}>{isNew ? <i className={styles.dot} aria-label="Unread" /> : null}<span>{item.task.text}</span></span>
                <span className={styles.line}>{event.summary}</span>
              </button>
              <Link className={styles.workflow} href={workflowHref(item.task.id)} aria-label={`Open workflow for ${item.task.text}`} title="Open workflow">
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.foot}>
        {visible.length > limit ? <button type="button" className="btn btn-ghost" onClick={() => setLimit((n) => n + INBOX_PAGE)}>Show {Math.min(INBOX_PAGE, visible.length - limit)} more</button> : null}
        <button type="button" className="btn btn-ghost" aria-pressed={showRead} onClick={() => { setShowRead((current) => !current); setLimit(INBOX_PAGE); }}>{showRead ? "Unread only" : "Show read updates"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => void requestNotifyPermission().then((value) => setPermission(value === "granted" ? "Desktop alerts on" : `Desktop alerts ${value}`))}>
          {permission || "Desktop alerts"}
        </button>
      </div>
      {menu.target && menu.position ? (
        <InboxItemMenu item={menu.target} position={menu.position} onClose={menu.close} onOpenCard={(taskId) => { menu.close(); onOpenCard(taskId); }} onChanged={() => void mutate()} />
      ) : null}
    </aside>
  );
}

/** The board header's Inbox toggle, with the unread count when there is one. */
export function InboxToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { data } = useWorkflowInbox();
  const unread = workflowUpdates(data?.items ?? []).filter((update) => update.unread).length;
  return (
    <button type="button" className="btn btn-ghost" aria-pressed={open} aria-expanded={open} aria-controls="workflow-inbox" onClick={onToggle}>
      Updates{unread ? <span className="badge badge-muted" aria-label={`${unread} unread updates`}>{unread}</span> : null}
    </button>
  );
}
