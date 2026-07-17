"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { ResizeHandle } from "./ResizeHandle";
import { useIsMobile } from "@/lib/use-is-mobile";

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  ariaLabel: string;
  children: ReactNode;
}

export function SidePanel({
  open,
  onClose,
  storageKey,
  defaultWidth = 400,
  minWidth = 320,
  ariaLabel,
  children,
}: SidePanelProps) {
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = localStorage.getItem(storageKey);
    return stored ? Math.max(minWidth, Number(stored)) : defaultWidth;
  });
  const dragging = useRef(false);
  const panelWidthRef = useRef(panelWidth);
  const previousFocus = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = panelWidthRef.current;

      const shield = document.createElement("div");
      shield.style.cssText =
        "position:fixed;inset:0;z-index:var(--z-shield);cursor:col-resize;";
      document.body.appendChild(shield);

      let nextWidth = startWidth;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startX - ev.clientX;
        nextWidth = Math.min(
          window.innerWidth - 40,
          Math.max(minWidth, startWidth + delta),
        );
        setPanelWidth(nextWidth);
      };
      const onUp = () => {
        dragging.current = false;
        shield.remove();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        localStorage.setItem(storageKey, String(nextWidth));
      };
      shield.addEventListener("mousemove", onMove);
      shield.addEventListener("mouseup", onUp);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [minWidth, storageKey],
  );

  if (!open) return null;

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        top: "10vh",
        zIndex: 50,
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-panel)",
      }
    : {
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: panelWidth,
        zIndex: 50,
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-panel-side)",
      };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={isMobile ? "side-panel-enter-mobile" : "side-panel-enter"}
      style={containerStyle}
    >
      {!isMobile && (
        <ResizeHandle
          axis="w"
          onMouseDown={handleDragStart}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "6px",
            zIndex: 10,
          }}
        />
      )}
      {children}
    </div>
  );
}
