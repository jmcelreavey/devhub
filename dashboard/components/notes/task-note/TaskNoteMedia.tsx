"use client";

import { useCallback, useMemo, useState } from "react";
import { ImageViewer } from "@/components/ui/ImageViewer";
import type { MediaItem } from "@shared/task-note/sections.ts";
import styles from "./task-note.module.css";

function PhaseTag({ phase }: { phase: "before" | "after" }) {
  return <span className={`${styles.pill} ${styles.tag} ${phase === "after" ? styles.accent : styles.muted}`}>{phase}</span>;
}

function MediaTile({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const [failed, setFailed] = useState(false);
  const label = item.caption || item.name;
  return (
    <figure className={styles.shot} data-media-kind={item.kind}>
      {item.phase ? <PhaseTag phase={item.phase} /> : null}
      {failed ? (
        <div className={styles.mediaMissing}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.kind === "video" ? "Video" : "Image"} unavailable. Try the link
          </a>
        </div>
      ) : item.kind === "video" ? (
        <video
          className={styles.media}
          src={item.url}
          controls
          preload="metadata"
          playsInline
          aria-label={label}
          onError={() => setFailed(true)}
        />
      ) : (
        <button type="button" className={styles.thumb} onClick={() => onOpen(item)} aria-label={`Enlarge: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- notes assets are served by the app, not optimizable */}
          <img className={styles.media} src={item.url} alt={label} loading="lazy" onError={() => setFailed(true)} />
        </button>
      )}
      {item.caption ? <figcaption className={styles.caption}>{item.caption}</figcaption> : null}
    </figure>
  );
}

/** Screenshots and recordings as a grid. Images open in the in-app viewer, which browses every image; videos play in place. */
export function TaskNoteMedia({ items }: { items: MediaItem[] }) {
  const images = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const onOpen = useCallback((item: MediaItem) => setOpen(Math.max(0, images.indexOf(item))), [images]);
  return (
    <>
      <div className={styles.grid}>
        {items.map((item) => (
          <MediaTile key={item.id || item.url} item={item} onOpen={onOpen} />
        ))}
      </div>
      {open !== null ? (
        <ImageViewer
          label="Screenshots"
          images={images.map((item) => ({ url: item.url, caption: item.caption, name: item.name, ...(item.phase ? { tag: item.phase } : {}) }))}
          start={open}
          onClose={close}
        />
      ) : null}
    </>
  );
}
