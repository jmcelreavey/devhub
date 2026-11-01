"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { SidePanel } from "@/components/shell/SidePanel";
import styles from "./TaskDetailPanel.module.css";

export function WorkDetailFrame({ title, identity = "Task", onClose, children }: { title: string; identity?: string; onClose: () => void; children: ReactNode }) {
  return <>
    <div className={styles.backdrop} onClick={onClose} aria-hidden data-testid="task-detail-backdrop" />
    <SidePanel open onClose={onClose} storageKey="storyboard-note-width" defaultWidth={760} minWidth={420} ariaLabel={`${identity}: ${title}`} trapFocus>
      <header className={styles.header}>
        <h2 className={styles.title} tabIndex={-1}>{title}</h2>
        <button type="button" className="btn btn-ghost" aria-label={`Close ${identity === "PR" ? "PR" : "task"} details`} onClick={onClose}><X size={14} aria-hidden /></button>
      </header>
      <div className={styles.body}>{children}</div>
    </SidePanel>
  </>;
}
