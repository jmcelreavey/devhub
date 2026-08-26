"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, FileText, Link2, RefreshCw } from "lucide-react";
import type { JiraTicket } from "@/lib/jira/client";
import { extractTags } from "@/lib/entity-note";
import { copyTextAndToast } from "@/lib/pr-slack";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import { PersonChip } from "@/components/PersonChip";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { useTagMenuGroup, withTagsGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";

function ticketNotePath(key: string): string {
  return `tickets/${key}`;
}

function ticketNoteMarkdown(ticket: JiraTicket): string {
  return [`# ${ticket.key} ${ticket.summary}`, "", `**Jira:** [${ticket.key}](${ticket.url})`, ""].join("\n");
}

function formatUpdatedShort(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function JiraTicketRow({
  ticket,
  density = "compact",
  showUpdated = true,
}: {
  ticket: JiraTicket;
  density?: "compact" | "comfortable";
  showUpdated?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [transitionOpen, setTransitionOpen] = useState(false);
  const menu = useContextMenu<JiraTicket>();
  const notePath = ticketNotePath(ticket.key);
  const noteExists = useVaultNoteExists(notePath);
  const compact = density === "compact";

  const openNote = async () => {
    try {
      const result = await createOrOpenVaultNote({
        path: notePath,
        markdown: ticketNoteMarkdown(ticket),
      });
      router.push(result.href);
    } catch {
      toast.error("Couldn't open ticket note.");
    }
  };

  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "jira",
    id: ticket.key,
    label: ticket.summary,
    extraTags: extractTags(ticket.summary),
    enabled: menu.target !== null,
  });

  const groups: ContextMenuGroup[] = withTagsGroup(
    [
      {
        id: "ticket",
        items: [
          {
            id: "copy-key",
            label: "Copy key",
            icon: <Copy size={12} />,
            onSelect: () => void copyTextAndToast(ticket.key, ticket.key, toast),
          },
          {
            id: "open-jira",
            label: "Open in Jira",
            icon: <ExternalLink size={12} />,
            onSelect: () => void openInBrowser(ticket.url),
          },
          {
            id: "update-state",
            label: "Update ticket state",
            icon: <RefreshCw size={12} />,
            onSelect: () => setTransitionOpen(true),
          },
          {
            id: "note",
            label: noteExists ? "Open note" : "Create note",
            icon: <FileText size={12} />,
            onSelect: () => void openNote(),
          },
          {
            id: "copy-url",
            label: "Copy browse URL",
            icon: <Link2 size={12} />,
            onSelect: () => void copyTextAndToast(ticket.url, "browse URL", toast),
          },
        ],
      },
    ],
    tagsGroup,
  );

  return (
    <div
      className={`group relative flex min-w-0 items-start gap-2 ${compact ? "px-4 py-2.5" : "px-1 py-2"}`}
      {...menu.bindRow(ticket)}
    >
      <div className="min-w-0 flex-1">
        <a
          href={ticket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block min-w-0 no-underline"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className={`pr-row-title ${compact ? "text-sm" : "text-[15px]"}`}>{ticket.summary}</span>
        </a>
        <div className="pr-row-meta mt-0.5">
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pr-row-id no-underline hover:underline"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {ticket.key}
          </a>
          {ticket.assignee ? (
            <>
              <span className="text-text-subtle" aria-hidden>
                ·
              </span>
              <PersonChip
                name={ticket.assignee.displayName}
                email={ticket.assignee.email}
                avatarUrl={ticket.assignee.avatarUrl}
                size={16}
                className="hidden max-w-[9rem] sm:inline-flex"
              />
            </>
          ) : null}
          <JiraStatusPill ticketKey={ticket.key} status={ticket.status} />
          {showUpdated ? (
            <span
              className="text-[11px] tabular-nums text-text-subtle"
              title={ticket.updatedAt ? `Updated ${new Date(ticket.updatedAt).toLocaleString()}` : undefined}
            >
              {formatUpdatedShort(ticket.updatedAt)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {noteExists ? (
          <span className="row-note-glyph" title="Note exists" aria-hidden>
            <FileText size={12} />
          </span>
        ) : null}
        <RowMenuKebab
          label={`Actions for ${ticket.key}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, ticket)}
        />
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${ticket.key} actions`}
      />
      {tagsModal}
      <JiraTransitionModal
        open={transitionOpen}
        jiraKey={ticket.key}
        title="Update Jira status"
        skipLabel="Cancel"
        suggest={ticket.status}
        onCancel={() => setTransitionOpen(false)}
        onConfirm={async (transitionId) => {
          setTransitionOpen(false);
          if (!transitionId) return;
          try {
            const res = await fetch(`/api/jira/ticket/${ticket.key}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transitionId }),
            });
            if (!res.ok) throw new Error("Transition failed");
            toast.success(`Updated ${ticket.key}`);
          } catch {
            toast.error(`Couldn't transition ${ticket.key}`);
          }
        }}
      />
    </div>
  );
}
