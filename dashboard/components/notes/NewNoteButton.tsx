"use client";

import type { ReactNode } from "react";

/**
 * Fires the `devhub:new-note` event the notes layout listens for.
 *
 * Exists so the landing page can stay a server component — the modal lives in
 * the layout, and this is the smallest client island that can poke it.
 */
export function NewNoteButton({
  className,
  label,
  icon,
}: {
  className: string;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent("devhub:new-note"))}
    >
      {icon}
      {label}
    </button>
  );
}
