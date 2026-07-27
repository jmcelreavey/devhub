"use client";

import { Plus } from "lucide-react";

/**
 * Fires the `devhub:new-doc` event the docs shell listens for.
 *
 * Exists purely so the landing page can stay a server component — the modal
 * lives in the layout, and this is the smallest possible client island that can
 * poke it.
 */
export function NewDocButton({
  className,
  label,
  withIcon = false,
}: {
  className: string;
  label: string;
  withIcon?: boolean;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent("devhub:new-doc"))}
    >
      {withIcon ? <Plus size={14} aria-hidden /> : null}
      {label}
    </button>
  );
}
