"use client";

import { Copy, ExternalLink, FileText, RefreshCw } from "lucide-react";
import type { EntityRef } from "@/lib/entity-note";
import { defaultHrefForRef } from "@/lib/entity-note";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { jiraBrowseUrl } from "@/lib/utils";

export interface EntityRefMenuActions {
  onOpen: (ref: EntityRef) => void;
  onCopy: (text: string, label: string) => void;
  onUpdateJiraState?: (key: string) => void;
  onOpenNote?: (ref: EntityRef) => void;
}

/** Full per-kind menu so a chip/tag right-click matches the row menu. */
export function buildEntityRefMenuGroups(
  ref: EntityRef,
  actions: EntityRefMenuActions,
): ContextMenuGroup[] {
  const dest = ref.href ?? defaultHrefForRef(ref);
  const openItem = {
    id: "open",
    label: "Open",
    icon: <ExternalLink size={12} aria-hidden />,
    onSelect: () => actions.onOpen(ref),
    disabled: !dest,
  };

  if (ref.kind === "jira") {
    const key = ref.id.toUpperCase();
    const url = dest && /^https?:\/\//i.test(dest) ? dest : jiraBrowseUrl(key);
    return [
      {
        id: "jira",
        items: [
          {
            id: "open-jira",
            label: "Open in Jira",
            icon: <ExternalLink size={12} aria-hidden />,
            onSelect: () => actions.onOpen({ ...ref, href: url }),
          },
          ...(actions.onUpdateJiraState
            ? [
                {
                  id: "update-state",
                  label: "Update ticket state",
                  icon: <RefreshCw size={12} aria-hidden />,
                  onSelect: () => actions.onUpdateJiraState?.(key),
                },
              ]
            : []),
          {
            id: "copy-key",
            label: "Copy key",
            icon: <Copy size={12} aria-hidden />,
            onSelect: () => actions.onCopy(key, key),
          },
          ...(actions.onOpenNote
            ? [
                {
                  id: "note",
                  label: "Open note",
                  icon: <FileText size={12} aria-hidden />,
                  onSelect: () => actions.onOpenNote?.(ref),
                },
              ]
            : []),
        ],
      },
    ];
  }

  if (ref.kind === "tag") {
    const tag = ref.id.replace(/^#/, "");
    const token = `#${tag}`;
    return [
      {
        id: "tag",
        items: [
          openItem,
          {
            id: "copy-tag",
            label: "Copy tag",
            icon: <Copy size={12} aria-hidden />,
            onSelect: () => actions.onCopy(token, token),
          },
        ],
      },
    ];
  }

  return [{ id: "open", items: [openItem] }];
}
