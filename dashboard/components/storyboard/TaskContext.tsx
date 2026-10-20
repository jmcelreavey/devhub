"use client";

import { useState } from "react";
import { Images } from "lucide-react";
import { ImageViewer } from "@/components/ui/ImageViewer";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { TaskNoteView } from "@shared/task-note/sections.ts";
import { inlinePlainText } from "@shared/task-note/sections.ts";
import styles from "./TaskDetailPanel.module.css";

/** Every image on the card for the viewer; older payloads have no list, so the thumbnail alone is still viewable. */
export function cardViewerImages(card: BoardCard) {
  if (card.images?.length) return card.images.map((image) => ({ url: image.url, caption: image.caption, name: image.name, ...(image.source === "jev" ? { tag: "Jev" } : {}) }));
  const single = card.latestScreenshot ?? card.screenshot;
  return single ? [{ url: single.url, caption: single.caption }] : [];
}

/** `viewer`: open the image viewer here instead of calling `onOpen`, so a row that opens the task panel on click still shows the images. */
export function ScreenshotIndicator({ card, onOpen, viewer = false }: { card: BoardCard; onOpen?: () => void; viewer?: boolean }) {
  const [viewing, setViewing] = useState(false);
  const count = card.images.length;
  if (!card.latestScreenshot && !card.screenshot && !count) return null;
  const label = count > 1 ? `View ${count} images for ${card.title}` : `View screenshot for ${card.title}`;
  const open = viewer ? () => setViewing(true) : onOpen;
  const images = viewing ? cardViewerImages(card) : [];
  return <span className="inline-flex text-text-muted" title="Screenshot attached">
    {open ? <button type="button" className="btn btn-ghost" aria-label={label} aria-haspopup={viewer ? "dialog" : undefined} onClick={open}><Images size={13} aria-hidden />{count > 1 ? count : null}</button>
      : <Images size={13} aria-label="Screenshot attached" role="img" />}
    {viewing && images.length ? <ImageViewer label={`Images for ${card.title}`} images={images} onClose={() => setViewing(false)} /> : null}
  </span>;
}

/** Context comes from the note, including older unstructured summaries. Reading never starts a run. */
export function TaskContext({ card, view }: { card: BoardCard; view?: TaskNoteView }) {
  const [viewing, setViewing] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const update = view ? view.statusUpdate : card.statusUpdate;
  const summary = view ? view.summary.map(inlinePlainText).join(" ") : card.summary.join(" ");
  const screenshot = view?.latestScreenshot ?? card.latestScreenshot ?? card.screenshot;
  return <section className={styles.taskContext} aria-label="Task summary">
    <p className={summary ? styles.summary : "text-text-muted"}>{summary || "No summary yet"}</p>
    {update ? <dl className={styles.statusUpdate}>
      <div><dt>What changed</dt><dd>{update.whatChanged}</dd></div>
      <div><dt>Current state</dt><dd>{update.currentState}</dd></div>
      <div><dt>Next step</dt><dd>{update.nextStep}</dd></div>
    </dl> : null}
    {screenshot ? <button type="button" className={styles.latestScreenshot} aria-label="Enlarge latest screenshot" aria-haspopup="dialog" onClick={(event) => {
      // Safari doesn't focus clicked buttons; give the viewer a stable return target.
      event.currentTarget.focus();
      setViewing(true);
    }}>
      {failedUrl === screenshot.url ? <span>Screenshot unavailable · open viewer</span> : <>
        {/* eslint-disable-next-line @next/next/no-img-element -- vault assets use the authenticated asset route */}
        <img src={screenshot.url} alt={screenshot.caption || "Latest task screenshot"} onError={() => setFailedUrl(screenshot.url)} />
        <span>{screenshot.caption || "Latest screenshot"} · Enlarge</span>
      </>}
    </button> : null}
    {viewing && screenshot ? <ImageViewer label="Latest task screenshot" images={[screenshot]} onClose={() => setViewing(false)} /> : null}
  </section>;
}
