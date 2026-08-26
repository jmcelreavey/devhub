"use client";

import { useState } from "react";
import { copyWithToast, copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { jiraBrowseUrl } from "@/lib/utils";
import type { EntityRef } from "@/lib/entity-note";

interface JiraKeyChipProps {
  jiraKey: string;
  /** Dim + strike when the owning task is done. */
  done?: boolean;
}

/**
 * Mono Jira-key chip — click to copy the key. Right-click opens the full
 * Jira entity menu (open / update state / copy) so the row menu doesn't
 * swallow the chip.
 */
export function JiraKeyChip({ jiraKey, done = false }: JiraKeyChipProps) {
  const toast = useToast();
  const menu = useContextMenu<EntityRef>();
  const [transitionOpen, setTransitionOpen] = useState(false);
  const ref: EntityRef = {
    kind: "jira",
    id: jiraKey,
    label: jiraKey,
    href: jiraBrowseUrl(jiraKey),
  };
  const groups = buildEntityRefMenuGroups(ref, {
    onOpen: (target) => {
      const dest = target.href ?? jiraBrowseUrl(jiraKey);
      if (dest) window.open(dest, "_blank", "noopener,noreferrer");
    },
    onCopy: (text, label) => void copyTextAndToast(text, label, toast),
    onUpdateJiraState: () => setTransitionOpen(true),
  });

  return (
    <>
      <button
        type="button"
        data-entity-chip=""
        data-kind="jira"
        className="jira-key-chip shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs"
        aria-label={`Jira ${jiraKey}`}
        title={`Copy ${jiraKey}`}
        onClick={copyWithToast(jiraKey, jiraKey, toast)}
        onContextMenu={(e) => menu.openAt(e, ref)}
        style={{
          background: "var(--accent-dim)",
          color: "var(--accent)",
          border: "none",
          textDecoration: done ? "line-through" : "none",
          opacity: done ? 0.5 : 1,
        }}
      >
        {jiraKey}
      </button>
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
        onConfirm={async (transitionId) => {
          setTransitionOpen(false);
          if (!transitionId) return;
          try {
            const res = await fetch(`/api/jira/ticket/${jiraKey}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transitionId }),
            });
            if (!res.ok) throw new Error("Transition failed");
            toast.success(`Updated ${jiraKey}`);
          } catch {
            toast.error(`Couldn't transition ${jiraKey}`);
          }
        }}
      />
    </>
  );
}
