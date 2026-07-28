import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TipPos = "top" | "top-end" | "bottom" | "left" | "bottom-end" | "bottom-start";

/**
 * Electron/Chromium-safe tooltip wrapper.
 *
 * A disabled <button>/<input> does not emit pointer events, so native `title`
 * never fires on it. Wrapping the control in this (non-disabled) span moves the
 * hover target off the disabled element so the portal tooltip still shows.
 *
 * Renders the tooltip attribute only when `label` is truthy, so an enabled
 * control with no reason shows nothing.
 */
export function HoverTip({
  label,
  pos = "top",
  className,
  style,
  children,
}: {
  label?: string | null | false;
  pos?: TipPos;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  }, []);

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (pos === "top") setPosition({ left: rect.left + rect.width / 2, top: rect.top - 6, transform: "translate(-50%, -100%)" });
    else if (pos === "top-end") setPosition({ left: rect.right, top: rect.top - 6, transform: "translate(-100%, -100%)" });
    else if (pos === "left") setPosition({ left: rect.left - 8, top: rect.top + rect.height / 2, transform: "translate(-100%, -50%)" });
    else if (pos === "bottom-start") setPosition({ left: rect.left, top: rect.bottom + 6 });
    else if (pos === "bottom-end") setPosition({ left: rect.right, top: rect.bottom + 6, transform: "translateX(-100%)" });
    else setPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 6, transform: "translateX(-50%)" });
  }, [pos]);

  const show = useCallback(() => {
    if (!label) return;
    updatePosition();
    setPortalRoot(rootRef.current?.closest("dialog") ?? document.body);
    setOpen(true);
  }, [label, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => hide, [hide]);

  // Modals / menus fire this so tips don't float over dialogs after a click.
  useEffect(() => {
    window.addEventListener("devhub:dismiss-hovertips", hide);
    return () => window.removeEventListener("devhub:dismiss-hovertips", hide);
  }, [hide]);

  return (
    <>
      <span
        ref={rootRef}
        contentEditable={false}
        className={className}
        style={{ display: "inline-flex", flexShrink: 0, ...style }}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => {
          if (label) timerRef.current = setTimeout(show, 800);
        }}
        onPointerLeave={hide}
        onFocusCapture={show}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
        }}
      >
        {children}
      </span>
      {open && label && position && portalRoot
        ? createPortal(
            <span id={id} role="tooltip" className="portal-tooltip" style={position}>{label}</span>,
            portalRoot,
          )
        : null}
    </>
  );
}
