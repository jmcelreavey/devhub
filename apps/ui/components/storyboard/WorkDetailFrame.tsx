"use client";

import type { ReactNode } from "react";
import { SidePanel, SidePanelControls } from "@/components/shell/SidePanel";
import styles from "./TaskDetailPanel.module.css";

export function WorkDetailFrame({ title, identity = "Task", onClose, children }: { title: string; identity?: string; onClose: () => void; children: ReactNode }) {
  return <>
    <div className={styles.backdrop} onClick={onClose} aria-hidden data-testid="task-detail-backdrop" />
    <SidePanel open onClose={onClose} storageKey="storyboard-note-width" defaultWidth={760} minWidth={420} ariaLabel={`${identity}: ${title}`} trapFocus>
      <header className={styles.header} data-panel-drag-handle>
        <h2 className={styles.title} tabIndex={-1}>{title}</h2>
        <SidePanelControls closeLabel={`Close ${identity === "PR" ? "PR" : "task"} details`} />
      </header>
      <div className={styles.body}>{children}</div>
    </SidePanel>
  </>;
}
