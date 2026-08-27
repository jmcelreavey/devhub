"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { parseMarkdownLinks, splitTagTokens } from "@/lib/tasks/task-text";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { buildEntityRefMenuGroups } from "@/lib/entity-ref-menu";
import type { EntityRef } from "@/lib/entity-note";
import { copyTextAndToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/hooks/use-toast";

/** Opens the shared menu for one chip. */
type OpenChipMenu = (event: ReactMouseEvent, ref: EntityRef) => void;

/**
 * Render task text with its markdown links and #tags live.
 *
 * A component, not a `render*` helper, because the #tag chips share one context
 * menu. Giving every chip its own `useContextMenu` + `<ContextMenu>` mounted two
 * menus per visible task row and rebuilt their groups on every render — the same
 * mistake `EntityLinkChips` already avoids by hoisting one menu over its chips.
 *
 * The parsing half is pure and lives in `lib/tasks/task-text.ts` so it can be
 * tested without React.
 */
export function TaskTextContent({ text }: { text: string }) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<EntityRef>();
  const target = menu.target;

  return (
    <>
      {renderTaskTextNodes(text, menu.openAt)}
      {target && (
        <ContextMenu
          open
          position={menu.position}
          groups={buildEntityRefMenuGroups(target, {
            onOpen: () => target.href && router.push(target.href),
            onCopy: (value, copied) => void copyTextAndToast(value, copied, toast),
          })}
          onClose={menu.close}
          label={`${target.label} actions`}
        />
      )}
    </>
  );
}

function renderTaskTextNodes(text: string, openChipMenu: OpenChipMenu): ReactNode {
  const parts = parseMarkdownLinks(text);
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === "text")) {
    return renderTaggedText(text, openChipMenu);
  }
  return parts.map((part, i) => {
    if (part.type === "link" && part.url) {
      // In-app links (e.g. a lab's Learnings note) navigate like every other
      // internal link; only external URLs get a new tab.
      const internal = part.url.startsWith("/");
      return internal ? (
        <Link
          key={i}
          href={part.url}
          onClick={(e) => e.stopPropagation()}
          className="text-accent underline underline-offset-2"
        >
          {part.text}
        </Link>
      ) : (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-accent underline underline-offset-2"
        >
          {part.text}
        </a>
      );
    }
    return <span key={i}>{renderTaggedText(part.text, openChipMenu)}</span>;
  });
}

function HashtagChip({
  tag,
  text,
  onOpenMenu,
}: {
  tag: string;
  text: string;
  onOpenMenu: OpenChipMenu;
}) {
  const href = `/work?tag=${encodeURIComponent(tag)}`;
  const ref: EntityRef = { kind: "tag", id: tag, label: text, href };
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => onOpenMenu(e, ref)}
      className="entity-link-chip"
      data-entity-chip=""
      data-kind="tag"
    >
      {text}
    </Link>
  );
}

/** Chips shown inline before collapsing the rest into one "+N" affordance. */
const MAX_TITLE_TAGS = 2;

/**
 * Plain text with `#tag` tokens rendered as drill-in chips to /work?tag=.
 *
 * Consecutive chips are grouped in a nowrap cluster so a wrapping title moves
 * them as one block instead of interleaving pills mid-wrap, and anything past
 * MAX_TITLE_TAGS collapses into a single "+N" chip at the end of the title.
 */
function renderTaggedText(text: string, openChipMenu: OpenChipMenu): ReactNode {
  const parts = splitTagTokens(text);
  if (!parts.some((p) => p.type === "tag")) return text;

  const nodes: ReactNode[] = [];
  let cluster: ReactNode[] = [];
  let shown = 0;
  const hidden: string[] = [];

  const flushCluster = (key: string) => {
    if (cluster.length === 0) return;
    nodes.push(
      <span key={key} className="task-title-tags">
        {cluster}
      </span>,
    );
    cluster = [];
  };

  parts.forEach((part, i) => {
    if (part.type === "tag") {
      if (shown < MAX_TITLE_TAGS) {
        cluster.push(
          <HashtagChip key={i} tag={part.tag!} text={part.text} onOpenMenu={openChipMenu} />,
        );
        shown += 1;
      } else {
        hidden.push(part.tag!);
      }
      return;
    }
    // Whitespace between tags is replaced by the cluster's own gap.
    if (cluster.length > 0 && part.text.trim() === "") return;
    flushCluster(`tags-${i}`);
    if (part.text) nodes.push(<span key={i}>{part.text}</span>);
  });

  if (hidden.length > 0) {
    cluster.push(
      <span
        key="more"
        className="entity-link-chip entity-link-chip-more"
        title={hidden.map((t) => `#${t}`).join(" ")}
      >
        +{hidden.length}
      </span>,
    );
  }
  flushCluster("tags-end");
  return nodes;
}
