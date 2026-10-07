"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTION_TABS, gateAllows, matchesNavRoute } from "@/lib/nav";
import { useIsDesktopPointer } from "@/lib/hooks/use-is-mobile";
import { useSetupStatus } from "@/lib/hooks/use-setup-status";

/**
 * Top-bar tab strip for merged destinations (2026-06 IA): when the current
 * route belongs to the Library (/notes, /docs, …) or System (/status, /logs,
 * …) families, show its sibling pages as tabs. BI destinations (Ops, Datadog)
 * are first-class sidebar items under the BI group — no top-bar strip. Gated
 * tabs only appear when their integration is configured.
 */
export function SectionTabs() {
  const pathname = usePathname();
  // Same `desktopOnly` test as the sidebar. This used to ask "is this the
  // Tauri shell?", so a browser tab on /logs showed a strip without Logs in it.
  const desktop = useIsDesktopPointer();
  const setup = useSetupStatus();

  const section = Object.values(SECTION_TABS).find((tabs) =>
    tabs.some((t) => matchesNavRoute(pathname, t.href)),
  );
  if (!section) return null;

  const visible = section.filter(
    (t) => gateAllows(t.gate, setup ?? null) && (!t.desktopOnly || desktop),
  );
  if (visible.length < 2) return null;

  // Longest matching href wins, so /status does not steal active from /status/….
  // (Sibling tabs like /logs are exact matches and win over a shorter prefix.)
  const activeHref = visible
    .filter((t) => matchesNavRoute(pathname, t.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Section" className="hub-section-tabs">
      {visible.map((t) => {
        const active = t.href === activeHref;
        return (
          <Link key={t.href} href={t.href} className="hub-section-tab" data-active={active || undefined} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
