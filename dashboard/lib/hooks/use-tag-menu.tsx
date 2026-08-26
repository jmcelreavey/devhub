"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Hash } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { type EntityKind, type EntityRef } from "@/lib/entity-note";
import { TagsModal } from "@/components/shell/TagsModal";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";

interface EntityLinksTagPayload {
  related: EntityRef[];
}

export interface UseTagMenuGroupParams {
  /** Entity kind /api/entity-links understands; null skips the server lookup (extraTags only). */
  kind: EntityKind | null;
  id: string;
  date?: string;
  label?: string;
  href?: string;
  meetingTitle?: string;
  prRepo?: string;
  prNumber?: number;
  /** Tags already known client-side (e.g. parsed from visible title text) — merged with the server lookup. */
  extraTags?: string[];
  /** Fetch only once the menu is actually open, so a long list doesn't fire a request per row on mount. */
  enabled: boolean;
  onAddTag?: (tag: string) => void | Promise<void>;
  onRemoveRef?: (ref: EntityRef) => void | Promise<void>;
  onAddLink?: () => void;
  onTagContextMenu?: (e: MouseEvent, ref: EntityRef) => void;
}

export interface TagMenuResult {
  /** Single "Tags" entry for the row's context menu — opens `modal` on select. */
  group: ContextMenuGroup;
  /** Render this once alongside the row's own <ContextMenu>. */
  modal: ReactNode;
  /** Open the tags dialog from a visible control, not only the hover kebab. */
  openModal: () => void;
}

/**
 * "Tags" context-menu entry shared by every right-clickable row: real #tags
 * on the entity plus anything else linked to it (a task that references this
 * Jira ticket, a note that mentions this PR, …) — reusing /api/entity-links,
 * the same lookup EntityLinkChips already does for its inline chips, so SWR
 * dedupes when both are mounted on a row.
 *
 * The full list opens in its own modal rather than as a submenu — a row with
 * a handful of hashtags plus reverse links ran the context menu off the
 * bottom of the screen.
 */
export function useTagMenuGroup({
  kind,
  id,
  date,
  label,
  href,
  meetingTitle,
  prRepo,
  prNumber,
  extraTags,
  enabled,
  onAddTag,
  onRemoveRef,
  onAddLink,
  onTagContextMenu,
}: UseTagMenuGroupParams): TagMenuResult {
  const [open, setOpen] = useState(false);
  // ContextMenu closes the row menu (enabled -> false) before the "View tags"
  // item's onSelect runs, so the fetch must stay keyed while the modal itself
  // is open too — otherwise the key nulls out right as the modal appears and
  // it opens on stale/empty data.
  const key = useMemo(() => {
    if (!(enabled || open) || !kind) return null;
    const qs = new URLSearchParams({ kind, id });
    if (date) qs.set("date", date);
    if (label) qs.set("label", label);
    if (href) qs.set("href", href);
    if (meetingTitle) qs.set("meetingTitle", meetingTitle);
    if (prRepo) qs.set("prRepo", prRepo);
    if (prNumber != null) qs.set("prNumber", String(prNumber));
    return `/api/entity-links?${qs}`;
  }, [enabled, open, kind, id, date, label, href, meetingTitle, prRepo, prNumber]);
  const { data } = useLive<EntityLinksTagPayload>(key);

  const seen = new Set<string>();
  const refs: EntityRef[] = [];
  for (const tag of extraTags ?? []) {
    const refKey = `tag:${tag}`;
    if (seen.has(refKey)) continue;
    seen.add(refKey);
    refs.push({ kind: "tag", id: tag, label: `#${tag}`, href: `/work?tag=${encodeURIComponent(tag)}` });
  }
  for (const ref of data?.related ?? []) {
    const refKey = `${ref.kind}:${ref.id}`;
    if (seen.has(refKey)) continue;
    seen.add(refKey);
    refs.push(ref);
  }

  const group: ContextMenuGroup = {
    id: "tags",
    label: "Tags",
    items: [
      {
        id: "view-tags",
        label: "View tags",
        description: refs.length > 0 ? `${refs.length} linked` : "No tags yet",
        icon: <Hash size={12} aria-hidden />,
        onSelect: () => setOpen(true),
      },
    ],
  };

  const modal = (
    <TagsModal
      open={open}
      onClose={() => setOpen(false)}
      kind={kind ?? undefined}
      title={label}
      refs={refs}
      onAddTag={onAddTag}
      onRemoveRef={onRemoveRef}
      onAddLink={onAddLink}
      onTagContextMenu={onTagContextMenu}
    />
  );

  return { group, modal, openModal: () => setOpen(true) };
}

/** Splice a group in just before the row's "danger" group, or append it. */
export function withTagsGroup(
  groups: ContextMenuGroup[],
  tagsGroup: ContextMenuGroup | null,
): ContextMenuGroup[] {
  if (!tagsGroup) return groups;
  const dangerIndex = groups.findIndex((g) => g.id === "danger");
  if (dangerIndex === -1) return [...groups, tagsGroup];
  return [...groups.slice(0, dangerIndex), tagsGroup, ...groups.slice(dangerIndex)];
}
