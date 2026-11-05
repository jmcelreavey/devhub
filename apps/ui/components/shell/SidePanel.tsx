"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useCallback, type CSSProperties, type ReactNode } from "react";
import { GripVertical, Maximize2, Minimize2, X } from "lucide-react";
import { DockFrameControls } from "@/components/shell/DockFrameControls";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { HoverTip } from "@/components/ui/HoverTip";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";

interface PanelControls {
  floating: boolean;
  expanded: boolean;
  isMobile: boolean;
  toggleFloating: () => void;
  toggleExpanded: () => void;
  onClose: () => void;
}

const PanelControlsContext = createContext<PanelControls | null>(null);

export function SidePanelControls({ closeLabel }: { closeLabel: string }) {
  const controls = useContext(PanelControlsContext);
  if (!controls) return null;
  const { floating, expanded, isMobile, toggleFloating, toggleExpanded, onClose } = controls;
  const expandLabel = expanded ? "Restore panel size" : "Expand panel";
  return <div className="flex shrink-0 items-center gap-1">
    {floating && !expanded && !isMobile && <span data-panel-drag-handle className="hub-icon-btn cursor-grab" title="Drag panel"><GripVertical size={14} aria-hidden /></span>}
    {!isMobile && <DockFrameControls frame={floating ? "popout" : "dock"} onPopOut={toggleFloating} />}
    <HoverTip label={expandLabel}>
      <button type="button" className="hub-icon-btn" aria-label={expandLabel} aria-pressed={expanded} onClick={toggleExpanded}>
        {expanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
      </button>
    </HoverTip>
    <HoverTip label={closeLabel}>
      <button type="button" className="hub-icon-btn ml-2" aria-label={closeLabel} onClick={onClose}><X size={16} aria-hidden /></button>
    </HoverTip>
  </div>;
}

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  ariaLabel: string;
  trapFocus?: boolean;
  mode?: "panel" | "inline";
  keepMounted?: boolean;
  inlineStyle?: CSSProperties;
  style?: CSSProperties;
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
  mode = "panel",
  keepMounted = false,
  inlineStyle,
  style,
  children,
}: SidePanelProps) {
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = localStorage.getItem(storageKey);
    return stored && Number.isFinite(Number(stored)) ? Math.max(minWidth, Number(stored)) : defaultWidth;
  });
  const dragging = useRef(false);
  const panelWidthRef = useRef(panelWidth);
  const previousFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isMobile = useIsMobile();
  const [floating, setFloating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [floatingSize, setFloatingSize] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const moveStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const isPanel = mode === "panel";

  const rememberFloatingSize = () => {
    if (!floating || expanded || !panelRef.current) return;
    const { width, height } = panelRef.current.getBoundingClientRect();
    setFloatingSize({ width, height });
  };
  const toggleFloating = () => {
    rememberFloatingSize();
    setExpanded(false);
    setFloating(value => !value);
  };
  const toggleExpanded = () => {
    rememberFloatingSize();
    setExpanded(value => !value);
  };

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (!open || !isPanel) return;
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
  }, [open, trapFocus, isPanel]);

  useEffect(() => {
    if (!open || !isPanel || !floating || expanded) return;
    const constrainPosition = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(current => current ? {
        x: Math.max(0, Math.min(current.x, window.innerWidth - rect.width)),
        y: Math.max(0, Math.min(current.y, window.innerHeight - rect.height)),
      } : current);
    };
    window.addEventListener("resize", constrainPosition);
    return () => window.removeEventListener("resize", constrainPosition);
  }, [open, isPanel, floating, expanded]);

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

  if (!open && !keepMounted) return null;

  const containerStyle: CSSProperties = !isPanel ? { display: "flex", flexDirection: "column", ...inlineStyle } : isMobile
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
    <PanelControlsContext.Provider value={isPanel ? { floating, expanded, isMobile, toggleFloating, toggleExpanded, onClose } : null}>
    <div
      ref={panelRef}
      hidden={!open}
      tabIndex={isPanel && trapFocus ? -1 : undefined}
      role={isPanel ? "dialog" : "region"}
      aria-modal={isPanel && trapFocus || undefined}
      aria-label={ariaLabel}
      className={isPanel ? isMobile ? "side-panel-enter-mobile" : "side-panel-enter" : undefined}
      style={{ ...containerStyle, minHeight: 0, overflow: isPanel ? "hidden" : undefined, ...(isPanel && !isMobile && floating ? {
        top: position?.y ?? 80,
        left: position?.x,
        right: position ? "auto" : 24,
        bottom: "auto",
        width: `min(${floatingSize?.width ?? panelWidth}px, calc(100vw - 32px))`,
        height: `min(${floatingSize?.height ?? 720}px, calc(100dvh - 104px))`,
        maxHeight: "calc(100dvh - 32px)",
        maxWidth: "calc(100vw - 32px)",
        minWidth: `min(${minWidth}px, calc(100vw - 32px))`,
        minHeight: "min(240px, calc(100dvh - 32px))",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        resize: "both",
      } : {}), ...(isPanel && expanded ? {
        top: 0, left: 0, right: 0, bottom: 0,
        width: "100vw", height: "100dvh", maxWidth: "100vw", maxHeight: "100dvh",
        borderRadius: 0, resize: "none",
      } : {}), ...style, ...(!open ? { display: "none" } : {}) }}
      onPointerDown={(event) => {
        if (!isPanel || !floating || expanded || isMobile || event.button !== 0 || !(event.target instanceof Element)
          || !event.target.closest("[data-panel-drag-handle]") || event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        moveStart.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!event.buttons) { moveStart.current = null; return; }
        const start = moveStart.current;
        if (!start) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ x: Math.max(0, Math.min(window.innerWidth - rect.width, start.left + event.clientX - start.x)), y: Math.max(0, Math.min(window.innerHeight - rect.height, start.top + event.clientY - start.y)) });
      }}
      onPointerUp={() => { moveStart.current = null; }}
      onPointerCancel={() => { moveStart.current = null; }}
      onLostPointerCapture={() => { moveStart.current = null; }}
    >
      {isPanel && !isMobile && !floating && !expanded && (
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
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
    </PanelControlsContext.Provider>
  );
}
