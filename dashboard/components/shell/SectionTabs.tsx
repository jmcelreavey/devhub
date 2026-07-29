"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTION_TABS, gateAllows, type SetupGateStatus } from "@/lib/nav";
import { useLive } from "@/lib/hooks/use-fetch";
import { isDesktop } from "@/lib/desktop/bridge";

/**
 * Top-bar tab strip for merged destinations (2026-06 IA): when the current
 * route belongs to the Library (/notes, /docs, …) or System (/status, /ops,
 * …) families, show its sibling pages as tabs. Gated tabs only appear when
 * their integration is configured — same source of truth as the sidebar.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const desktop = isDesktop();
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", {
    refreshInterval: 0,
  });

  const section = Object.values(SECTION_TABS).find((tabs) =>
    tabs.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)),
  );
  if (!section) return null;

  const visible = section.filter(
    (t) => gateAllows(t.gate, setup ?? null) && (!t.desktopOnly || desktop),
  );
  if (visible.length < 2) return null;

  // Longest matching href wins, so /status does not steal active from /status/….
  // (Sibling tabs like /logs are exact matches and win over a shorter prefix.)
  const activeHref = visible
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Section" className="hub-section-tabs">
      {visible.map((t) => {
        const active = t.href === activeHref;
        return (
          <Link key={t.href} href={t.href} className="hub-section-tab" data-active={active || undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
