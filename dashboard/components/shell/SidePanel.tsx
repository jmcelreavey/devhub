"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  ariaLabel: string;
  trapFocus?: boolean;
  children: ReactNode;
}

export function SidePanel({
  open,
  onClose,
  storageKey,
  defaultWidth = 400,
  minWidth = 320,
  ariaLabel,
  trapFocus = false,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isMobile = useIsMobile();

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    if (trapFocus) panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (trapFocus && e.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, summary, [tabindex]') ?? []).filter((control) => {
          if (control.matches(":disabled") || control.closest("[hidden], [inert]") || control.tabIndex < 0) return false;
          let ancestor = control.parentElement;
          while (ancestor && ancestor !== panelRef.current) {
            if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector("summary")?.contains(control)) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        });
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { e.preventDefault(); panelRef.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [open, trapFocus]);

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
        zIndex: "var(--z-dropdown)",
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
        maxWidth: "100vw",
        zIndex: "var(--z-dropdown)",
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-panel-side)",
      };

  return (
    <div
      ref={panelRef}
      tabIndex={trapFocus ? -1 : undefined}
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
