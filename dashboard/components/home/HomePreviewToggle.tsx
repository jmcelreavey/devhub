"use client";

import styles from "./HomeWorkSummary.module.css";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Keep the same control mounted so expanding and collapsing retain keyboard focus. */
export function HomePreviewToggle({ total, limit, expanded, onToggle, controls, label }: {
  total: number; limit: number; expanded: boolean; onToggle: () => void; controls: string; label?: string;
}) {
  if (total <= limit && !label) return null;
  return <button type="button" className={styles.previewToggle} aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
    {expanded ? "Show less" : label ?? `Show ${total - limit} more`}
    {expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
  </button>;
}
