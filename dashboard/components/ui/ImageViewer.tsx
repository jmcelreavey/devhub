"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import styles from "./ImageViewer.module.css";

export interface ViewerImage {
  url: string;
  caption?: string;
  name?: string;
  /** Shown as a small tag, e.g. "before" / "after". */
  tag?: string;
}

function labelOf(image: ViewerImage): string {
  return image.caption || image.name || image.url.split("/").at(-1)?.split("?")[0] || "Image";
}

const FOCUSABLE = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * In-app image viewer: one image at a time over the page, ←/→ (or the arrow buttons) to browse,
 * Esc or a click outside to close. Focus stays inside while open and returns to whatever opened it.
 */
export function ImageViewer({ images, start = 0, onClose, label = "Images" }: { images: ViewerImage[]; start?: number; onClose: () => void; label?: string }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), Math.max(images.length - 1, 0)));
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = images.length;
  const image = images[index];
  const step = useCallback((by: -1 | 1) => setIndex((current) => (current + by + count) % count), [count]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      // The opener can re-render while the viewer is open; focus it if it is still on the page.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && count > 1) {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  if (!image) return null;
  const text = labelOf(image);
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.stage}>
          {count > 1 ? (
            <button type="button" className={styles.nav} onClick={() => step(-1)} aria-label="Previous image">
              <ChevronLeft size={18} aria-hidden />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- notes and QA assets are served by the app, not optimizable */}
          <img key={image.url} src={image.url} alt={text} draggable={false} />
          {count > 1 ? (
            <button type="button" className={styles.nav} onClick={() => step(1)} aria-label="Next image">
              <ChevronRight size={18} aria-hidden />
            </button>
          ) : null}
        </div>
        <div className={styles.bar}>
          {count > 1 ? <span className={styles.counter} aria-live="polite">{index + 1} / {count}</span> : null}
          {image.tag ? <span className={styles.tag}>{image.tag}</span> : null}
          <span className={styles.caption} title={text}>{text}</span>
          <a className={styles.action} href={image.url} target="_blank" rel="noopener noreferrer" aria-label="Open full size in a new tab">
            <ExternalLink size={13} aria-hidden />
          </a>
          <button ref={closeRef} type="button" className={styles.action} onClick={onClose} aria-label="Close viewer">
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
