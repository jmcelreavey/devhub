"use client";
import { useState, type ReactNode } from "react";
import { CornerLeftUp } from "lucide-react";
import { copyWithToast, copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { useJiraTransition } from "@/lib/hooks/use-jira-transition";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { jiraBrowseUrl } from "@/lib/utils";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { EntityRef } from "@/lib/entity-note";
import type { JiraTicketRef } from "@/lib/jira/client";

/**
 * The parent is context, not the row's identity, so it reads as muted mono text
 * behind a "belongs to" arrow and only lights up on hover. Still one click to copy.
 */
export function JiraParentChip({ parent, done = false }: { parent: JiraTicketRef; done?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center text-text-subtle">
      <CornerLeftUp size={11} aria-hidden style={{ opacity: done ? 0.5 : 0.8 }} />
      <JiraKeyChip
        quiet
        done={done}
        jiraKey={parent.key}
        href={parent.url}
        label={`Copy parent ticket key ${parent.key}`}
        title={parent.summary ? `Copy ${parent.key} · parent: ${parent.summary}` : `Copy parent ${parent.key}`}
      />
    </span>
  );
}

interface JiraKeyChipProps {
  jiraKey: string;
  /** Dim + strike when the owning task is done. */
  done?: boolean;
  label?: string;
  title?: string;
  /** Muted text until hovered, for references that should not compete with the row. */
  quiet?: boolean;
  /** Browse URL on the real Jira domain; falls back to the build-time domain. */
  href?: string;
  /** An owning surface may supply the full ticket-row menu and its dialogs. */
  menu?: { onOpen: (x: number, y: number, host: HTMLElement) => void; content: ReactNode };
}

/**
 * Mono Jira-key chip — click to copy the key. Right-click opens the full
 * Jira entity menu (open / update state / copy) so the row menu doesn't
 * swallow the chip.
 */
export function JiraKeyChip({ jiraKey, done = false, label, title, quiet = false, href, menu: suppliedMenu }: JiraKeyChipProps) {
  const toast = useToast();
  const move = useJiraTransition();
  const menu = useContextMenu<EntityRef>();
  const [transitionOpen, setTransitionOpen] = useState(false);
  const ref: EntityRef = {
    kind: "jira",
    id: jiraKey,
    label: jiraKey,
    href: href ?? jiraBrowseUrl(jiraKey),
  };
  const groups = buildEntityRefMenuGroups(ref, {
    // window.open is a silent no-op in the desktop webview; go through the shell opener.
    onOpen: (target) => void openInBrowser(target.href ?? jiraBrowseUrl(jiraKey)),
    onCopy: (text, label) => void copyTextAndToast(text, label, toast),
    onUpdateJiraState: () => setTransitionOpen(true),
  });

  return (
    <>
      <button
        type="button"
        data-entity-chip=""
        data-kind="jira"
        className={`jira-key-chip${quiet ? " jira-key-chip--quiet" : ""} shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs`}
        aria-label={label ?? `Jira ${jiraKey}`}
        title={title ?? `Copy ${jiraKey}`}
        onClick={copyWithToast(jiraKey, jiraKey, toast)}
        onContextMenu={(event) => {
          if (!suppliedMenu) { menu.openAt(event, ref); return; }
          event.preventDefault();
          event.stopPropagation();
          suppliedMenu.onOpen(event.clientX, event.clientY, event.currentTarget);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          if (suppliedMenu) suppliedMenu.onOpen(rect.left + 12, rect.bottom - 4, event.currentTarget);
          else menu.openAtPoint(rect.left + 12, rect.bottom - 4, ref, event.currentTarget);
        }}
        style={{
          // The quiet variant takes its colours from CSS so :hover can win.
          ...(quiet ? {} : { background: "var(--accent-dim)", color: "var(--accent-text, var(--accent))", border: "none" }),
          textDecoration: done ? "line-through" : "none",
          opacity: done ? 0.5 : 1,
        }}
      >
        {jiraKey}
      </button>
      {suppliedMenu ? suppliedMenu.content : <>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${jiraKey} actions`}
      />
      <JiraTransitionModal
        open={transitionOpen}
        jiraKey={jiraKey}
        title="Update Jira status"
        skipLabel="Cancel"
        onCancel={() => setTransitionOpen(false)}
        onConfirm={(transitionId, to) => {
          setTransitionOpen(false);
          if (transitionId) void move(jiraKey, { transitionId }, { to });
        }}
      />
      </>}
    </>
  );
}
