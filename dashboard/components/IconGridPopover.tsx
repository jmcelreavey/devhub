"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface IconGridPopoverOption<T extends string = string> {
  id: T;
  /** Tooltip / screen-reader label */
  label: string;
  render: (size: number) => ReactNode;
}

function formatIconLabel(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface PopoverCoords {
  top: number;
  left: number;
  minWidth: number;
  placement: "below" | "above";
}

const POPOVER_Z_BACKDROP = 8999;
const POPOVER_Z_PANEL = 9000;
/** Rough panel height for flip-above calculation (6 cols × ~2 rows). */
const PANEL_ESTIMATE_PX = 160;

export interface IconGridPopoverProps<T extends string = string> {
  value: T;
  onChange: (id: T) => void;
  options: IconGridPopoverOption<T>[];
  /** Grid columns in the popover (default 6). */
  columns?: number;
  /** Shown on the trigger button (accessibility). */
  triggerAriaLabel?: string;
  /** Optional label rendered beside the trigger. */
  fieldLabel?: string;
  /** Render only the trigger (e.g. embedded in a card header). */
  inline?: boolean;
  triggerIconSize?: number;
  triggerClassName?: string;
}

/**
 * Compact icon picker: one icon on the trigger, full grid in a portalled popover.
 * Same interaction model as the sidebar brand {@link IconPicker}.
 */
export function IconGridPopover<T extends string = string>({
  value,
  onChange,
  options,
  columns = 6,
  triggerAriaLabel = "Change icon",
  fieldLabel,
  inline = false,
  triggerIconSize = 18,
  triggerClassName,
}: IconGridPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setCoords(null);
  }, []);

  const pick = useCallback(
    (id: T) => {
      onChange(id);
      close();
    },
    [onChange, close],
  );

  const updateCoords = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const minWidth = Math.min(columns * 44 + 16, window.innerWidth - 24);
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement =
      spaceBelow < PANEL_ESTIMATE_PX && rect.top > PANEL_ESTIMATE_PX ? "above" : "below";
    setCoords({
      left: Math.min(rect.left, window.innerWidth - minWidth - 12),
      top: placement === "below" ? rect.bottom + 4 : rect.top - 4,
      minWidth,
      placement,
    });
  }, [columns]);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    return () => {
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
    };
  }, [open, updateCoords]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const selected = options.find((o) => o.id === value) ?? options[0];
  const panelMinWidth = columns * 44 + 16;

  const portal =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <>
            <div
              className="fixed inset-0"
              style={{ zIndex: POPOVER_Z_BACKDROP }}
              aria-hidden
              onClick={close}
            />
            <div
              id={listId}
              role="listbox"
              aria-label="Choose icon"
              className="pop-soft fixed flex flex-col overflow-hidden rounded-lg border shadow-lg"
              style={{
                zIndex: POPOVER_Z_PANEL,
                left: coords.left,
                top: coords.top,
                transform: coords.placement === "above" ? "translateY(-100%)" : undefined,
                minWidth: `${Math.max(coords.minWidth, panelMinWidth)}px`,
                maxWidth: "min(320px, calc(100vw - 24px))",
                borderColor: "var(--border)",
                background: "var(--bg-elevated)",
                boxShadow: "var(--shadow-popover)",
              }}
            >
              <div
                className="grid gap-0.5 p-2"
                style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
              >
                {options.map((opt) => {
                  const isSelected = opt.id === value;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      title={opt.label}
                      className="flex h-10 w-10 items-center justify-center rounded-md border-2 p-0 transition-colors"
                      style={{
                        borderColor: isSelected ? "var(--accent)" : "transparent",
                        background: isSelected ? "var(--accent-dim)" : "transparent",
                        color: isSelected ? "var(--accent)" : "var(--text-subtle)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick(opt.id);
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = "var(--bg-surface)";
                          e.currentTarget.style.color = "var(--text)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-subtle)";
                        }
                      }}
                    >
                      {opt.render(20)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      className={
        triggerClassName ??
        "flex h-9 w-9 shrink-0 items-center justify-center rounded border transition-colors"
      }
      style={
        triggerClassName
          ? {
              borderColor: open ? "var(--accent)" : undefined,
              background: open ? "var(--accent-dim)" : undefined,
              color: "var(--accent)",
            }
          : {
              borderColor: open ? "var(--accent)" : "var(--border)",
              background: open ? "var(--accent-dim)" : "var(--bg-elevated)",
              color: "var(--accent)",
            }
      }
      onClick={(e) => {
        e.stopPropagation();
        if (open) close();
        else setOpen(true);
      }}
      aria-label={triggerAriaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listId : undefined}
      title={selected ? `${selected.label} - click to change` : triggerAriaLabel}
    >
      {selected ? selected.render(triggerIconSize) : null}
    </button>
  );

  if (inline) {
    return (
      <>
        {triggerButton}
        {portal}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {fieldLabel ? (
        <span className="text-xs shrink-0" style={{ color: "var(--text-subtle)" }}>
          {fieldLabel}
        </span>
      ) : null}
      {triggerButton}
      {portal}
    </div>
  );
}

/** Build options from string ids using a shared render helper. */
export function iconGridOptionsFromIds<T extends string>(
  ids: readonly T[],
  render: (id: T, size: number) => ReactNode,
  labelFn: (id: T) => string = (id) => formatIconLabel(id),
): IconGridPopoverOption<T>[] {
  return ids.map((id) => ({
    id,
    label: labelFn(id),
    render: (size) => render(id, size),
  }));
}
