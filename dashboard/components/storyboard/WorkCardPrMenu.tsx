"use client";

import { useRouter } from "next/navigation";
import { PanelRight } from "lucide-react";
import { buildPrRowMenuGroups, openPrRowNote } from "@/components/PrRowActions";
import { ContextMenu, type ContextMenuPosition } from "@/components/shell/ContextMenu";
import { useTagMenuGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";
import type { GithubPrRow } from "@/lib/github/prs";

/** Review-request cards get the PRs page's review menu, plus the in-place review panel. */
export function WorkCardPrMenu({ pr, open, position, onClose, onOpen }: {
  pr: GithubPrRow; open: boolean; position: ContextMenuPosition | null; onClose: () => void; onOpen?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "pr", id: `${pr.repo}#${pr.number}`, label: pr.title, prRepo: pr.repo, prNumber: pr.number, enabled: open,
  });
  const groups = [
    ...(onOpen ? [{ id: "details", items: [{ id: "details", label: "Open review", icon: <PanelRight size={12} aria-hidden />, onSelect: onOpen }] }] : []),
    ...buildPrRowMenuGroups({ row: pr, kind: "reviews", toast, tagsGroup, openNote: () => openPrRowNote(pr, (href) => router.push(href), toast) }),
  ];
  return <>
    <ContextMenu open={open} position={position} onClose={onClose} label={`Card actions for ${pr.title}`} groups={groups} />
    {tagsModal}
  </>;
}
