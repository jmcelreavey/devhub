"use client";

import { type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ExternalLink, GitBranch, GitPullRequest, Link2, ListChecks, Workflow, XCircle } from "lucide-react";
import { ContextMenu, useContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { openInBrowser } from "@/lib/desktop/bridge";
import {
  buildPrStatusMenuModel,
  type PrStatusMenuModelItem,
  type PrStatusMenuTarget,
} from "@/lib/github/pr-status-menu";
import { copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";

export interface PrStatusPillBind {
  "data-entity-chip": "";
  "data-pr-status-pill": "";
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

function iconFor(id: string, danger?: boolean): ReactNode {
  const props = { size: 12, "aria-hidden": true as const };
  switch (id) {
    case "open-pr":
      return <ExternalLink {...props} />;
    case "open-checks":
      return danger ? <XCircle {...props} /> : <ListChecks {...props} />;
    case "open-actions":
      return <Workflow {...props} />;
    case "copy-branch":
      return <GitBranch {...props} />;
    case "open-devhub-repo":
    case "open-devhub-prs":
      return <GitPullRequest {...props} />;
    default:
      return <Link2 {...props} />;
  }
}

function runMenuItem(
  item: PrStatusMenuModelItem,
  deps: { toast: ReturnType<typeof useToast>; push: (href: string) => void },
) {
  const action = item.action;
  if (action.type === "open-external") {
    void openInBrowser(action.url);
    return;
  }
  if (action.type === "copy") {
    void copyTextAndToast(action.text, action.toastLabel, deps.toast);
    return;
  }
  deps.push(action.href);
}

function menuLabel(target: PrStatusMenuTarget | null): string {
  if (!target) return "Pull request actions";
  const repo = target.repo?.trim();
  if (repo && target.number) return `${repo}#${target.number} status`;
  return "Pull request actions";
}

/**
 * Right-click / Shift+F10 / Context Menu key on a PR or CI status pill.
 * The menu is portaled so it stays valid inside buttons (the git rail badge).
 */
export function usePrStatusMenu(target: PrStatusMenuTarget | null): {
  bind: PrStatusPillBind;
  menuNode: ReactNode;
} {
  const menu = useContextMenu<PrStatusMenuTarget>();
  const toast = useToast();
  const router = useRouter();
  const model = target ? buildPrStatusMenuModel(target) : [];

  const groups: ContextMenuGroup[] = [
    { id: "github", label: "GitHub", matches: (item: PrStatusMenuModelItem) => item.action.type === "open-external" },
    { id: "devhub", label: "DevHub", matches: (item: PrStatusMenuModelItem) => item.action.type === "navigate" },
    { id: "copy", label: "Copy", matches: (item: PrStatusMenuModelItem) => item.action.type === "copy" },
  ].map(({ id, label, matches }) => ({
    id,
    label,
    items: model.filter(matches).map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      icon: iconFor(item.id, item.danger),
      onSelect: () => runMenuItem(item, { toast, push: (href) => router.push(href) }),
    })),
  })).filter((group) => group.items.length > 0);

  const bind: PrStatusPillBind = {
    "data-entity-chip": "",
    "data-pr-status-pill": "",
    onContextMenu: (event) => {
      if (!target || model.length === 0) return;
      menu.openAt(event, target);
    },
    onKeyDown: (event) => {
      if (!target || model.length === 0) return;
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      menu.openAtPoint(rect.left + 8, rect.bottom - 4, target, event.currentTarget as HTMLElement);
    },
  };

  const menuElement = (
    <ContextMenu
      open={menu.target !== null && model.length > 0}
      position={menu.position}
      groups={groups}
      onClose={menu.close}
      label={menuLabel(target)}
    />
  );

  // Portal only while open. A closed menu is not in the tree, so SSR and the
  // first client render match, and the menu is never a child of a <button>
  // (the git-rail badge).
  const menuNode =
    menu.target !== null && model.length > 0 && typeof document !== "undefined"
      ? createPortal(menuElement, document.body)
      : null;

  return { bind, menuNode };
}
