"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTION_TABS, gateAllows, type SetupGateStatus } from "@/lib/nav";
import { useLive } from "@/lib/use-fetch";

/**
 * Top-bar tab strip for merged destinations (2026-06 IA): when the current
 * route belongs to the Library (/notes, /docs, …) or System (/status, /ops,
 * …) families, show its sibling pages as tabs. Gated tabs only appear when
 * their integration is configured — same source of truth as the sidebar.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", {
    refreshInterval: 0,
  });

  const section = Object.values(SECTION_TABS).find((tabs) =>
    tabs.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)),
  );
  if (!section) return null;

  const visible = section.filter((t) => gateAllows(t.gate, setup ?? null));
  if (visible.length < 2) return null;

  return (
    <nav aria-label="Section" className="hub-section-tabs">
      {visible.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className="hub-section-tab" data-active={active || undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
