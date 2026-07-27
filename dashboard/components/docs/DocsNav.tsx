"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { DocNavGroup } from "@/lib/docs/doc-nav-types";

/**
 * Section-grouped docs navigation.
 *
 * Deliberately not the generic `FileTree`: docs browse by section and title,
 * not by filename, and a nav that shows `desktop-recovery` where the page says
 * "Recovering the desktop app" is a nav people stop trusting.
 */
export function DocsNav({ groups, search }: { groups: DocNavGroup[]; search: string }) {
  const pathname = usePathname();
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        docs: group.docs.filter(
          (doc) =>
            doc.title.toLowerCase().includes(query) ||
            doc.slug.toLowerCase().includes(query) ||
            (doc.description ?? "").toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.docs.length > 0);
  }, [groups, query]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.filter((g) => g.secondary).map((g) => [g.id, true])),
  );

  if (filtered.length === 0) {
    return <p className="docs-nav-empty">No docs match “{search}”.</p>;
  }

  return (
    <nav className="docs-nav" aria-label="Documentation">
      {filtered.map((group) => {
        // A search should never hide its own results behind a collapsed group.
        const isCollapsed = query ? false : collapsed[group.id] ?? false;
        return (
          <div key={group.id} className="docs-nav-group">
            <button
              type="button"
              className="docs-nav-heading"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))}
            >
              <ChevronDown size={11} className="docs-nav-chevron" aria-hidden />
              {group.label}
            </button>
            {isCollapsed ? null : (
              <ul className="docs-nav-list">
                {group.docs.map((doc) => (
                  <li key={doc.slug}>
                    <Link
                      href={doc.href}
                      className="docs-nav-link"
                      data-active={pathname === doc.href}
                    >
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
