"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { RowMenuKebab, useContextMenu } from "@/components/shell/ContextMenu";
import { WorkCardPrMenu } from "@/components/storyboard/WorkCardPrMenu";
import { notesPageHref } from "@/lib/notes/path";
import { openNoteInPanel, wantsFullPage } from "@/lib/notes/open-in-panel";
import type { ReviewedPr } from "@/lib/storyboard/reviewed-prs";
import styles from "./storyboard.module.css";

/** One reviewed PR with the same right-click and kebab menu its row had on the PRs page and old Home. */
function PrReviewCard({ pr, note }: ReviewedPr) {
  const menu = useContextMenu<string>();
  return (
    <article className={styles.card} aria-label={pr.title} tabIndex={0}
      onContextMenu={(event) => { event.preventDefault(); menu.openAtPoint(event.clientX, event.clientY, pr.url, event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        menu.openAtPoint(rect.left + 12, rect.top + 28, pr.url, event.currentTarget);
      }}>
      <div className={styles.body}>
      <a className={styles.title} href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.title}>{pr.title} <ExternalLink size={11} aria-hidden /></a>
      <p className={styles.progress}>{pr.repo} · #{pr.number}{pr.author ? ` · @${pr.author.login}` : ""}{pr.checks ? ` · checks ${pr.checks}` : ""}</p>
      <div className={styles.foot}>
        <Link className="btn btn-ghost" href={notesPageHref(note.path)} onClick={(event) => {
          // Plain click previews in the Notes side panel; ⌘/Ctrl/Shift/middle-click keeps the full page.
          if (wantsFullPage(event)) return;
          event.preventDefault();
          openNoteInPanel(note.path);
        }}>Open review note</Link>
        <RowMenuKebab label={`Actions for ${pr.title}`} onOpen={(x, y) => menu.openAtPoint(x, y, pr.url)} />
      </div>
      </div>
      <WorkCardPrMenu pr={pr} open={menu.target === pr.url} position={menu.position} onClose={menu.close} />
    </article>
  );
}

/** Reviews others asked John for that have been through the review skill and have a note. Read-only: nothing here moves a task. */
export function PrReviewsColumn({ items, collapsed, onToggle }: { items: ReviewedPr[]; collapsed: boolean; onToggle: () => void }) {
  return (
    <section className={`${styles.column} ${styles.reviewsColumn}`} data-collapsed={collapsed || undefined} data-empty={items.length === 0 || undefined} aria-label="PR reviews">
      <h2 className={styles.columnHead}>
        <button type="button" className={styles.columnToggle} aria-expanded={!collapsed} aria-controls="column-pr-reviews" onClick={onToggle}>
          <ChevronRight size={14} aria-hidden className={styles.chevron} />
          <span className={styles.columnLabel}>PR reviews</span>
          <span className={styles.columnCount}>{items.length}</span>
        </button>
      </h2>
      {!collapsed ? (
        <div id="column-pr-reviews" className={styles.columnCards}>
          <p className={styles.muted}>Review notes · read-only</p>
          {items.length === 0 ? <p className={styles.muted}>No reviewed PRs waiting on you.</p> : null}
          {items.map((item) => <PrReviewCard key={item.pr.url} {...item} />)}
        </div>
      ) : null}
    </section>
  );
}
