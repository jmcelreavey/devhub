"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/docs/markdown-ast";

/**
 * On-this-page nav with scroll spy.
 *
 * Uses IntersectionObserver against the heading elements the renderer emitted,
 * with a top-heavy root margin so a heading counts as "current" once it reaches
 * the upper third of the viewport rather than when it leaves the top entirely.
 */
export function DocToc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    if (entries.length === 0) return;
    const headings = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (headings.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) visible.add(record.target.id);
          else visible.delete(record.target.id);
        }
        // Pick the earliest visible heading so the highlight tracks reading
        // order rather than whichever entry fired last.
        const first = entries.find((entry) => visible.has(entry.id));
        if (first) setActiveId(first.id);
      },
      { rootMargin: "0px 0px -66% 0px", threshold: 0 },
    );

    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length < 2) return null;

  return (
    <nav className="docs-toc" aria-label="On this page">
      <p className="docs-toc-title">On this page</p>
      <ul className="docs-toc-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="docs-toc-link"
              data-level={entry.level}
              data-active={entry.id === activeId}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
