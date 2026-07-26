import type { CSSProperties, ReactNode } from "react";

type TipPos = "top" | "top-end" | "bottom" | "left" | "bottom-end" | "bottom-start";

/**
 * Electron/Chromium-safe tooltip wrapper.
 *
 * A disabled <button>/<input> does not emit pointer events, so neither the
 * native `title` nor the CSS `[data-tooltip]:hover` ever fires on it — the
 * reason a control is disabled becomes invisible on hover. Wrapping the control
 * in this (non-disabled) span moves the hover target off the disabled element
 * so the custom tooltip still shows.
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
  return (
    <span
      contentEditable={false}
      className={className}
      data-tooltip={label || undefined}
      data-tooltip-pos={pos}
      style={{ display: "inline-flex", flexShrink: 0, ...style }}
    >
      {children}
    </span>
  );
}
