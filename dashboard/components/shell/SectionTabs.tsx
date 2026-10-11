"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { SECTION_TABS, gateAllows, matchesNavRoute, type SectionTab } from "@/lib/nav";
import { useIsDesktopPointer } from "@/lib/hooks/use-is-mobile";
import { useSetupStatus } from "@/lib/hooks/use-setup-status";

/**
 * Top-bar tab strip for merged destinations (2026-06 IA): when the current
 * route belongs to the Library (/notes, /docs, …) or System (/status, /logs,
 * …) families, show its sibling pages as tabs. Infrastructure destinations (Ops, Datadog)
 * are first-class sidebar items under the Infrastructure group — no top-bar strip. Gated
 * tabs only appear when their integration is configured.
 *
 * Both forms are always rendered: the segmented strip, and a one-button menu
 * for bars too narrow to hold it. `.hub-topbar` container queries show exactly
 * one, so the choice follows the bar's own width, not the window's.
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
    <>
      <nav aria-label="Section" className="hub-section-tabs" data-dense={visible.length > 5 || undefined}>
        {visible.map((t) => {
          const active = t.href === activeHref;
          return (
            <Link key={t.href} href={t.href} className="hub-section-tab" data-active={active || undefined} aria-current={active ? "page" : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <SectionMenu tabs={visible} activeHref={activeHref} />
    </>
  );
}

/** Disclosure, not a menu role: the items are plain links, so Tab walks them. */
function SectionMenu({ tabs, activeHref }: { tabs: SectionTab[]; activeHref: string | undefined }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const active = tabs.find((t) => t.href === activeHref);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const observer = new ResizeObserver(() => {
      if (!rootRef.current?.getClientRects().length) setOpen(false);
    });
    if (rootRef.current) observer.observe(rootRef.current);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav
      ref={rootRef}
      aria-label="Section"
      className="hub-section-menu"
      data-dense={tabs.length > 5 || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="hub-section-menu-trigger"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={active ? `Section: ${active.label}. Switch section page` : "Switch section page"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hub-section-menu-label">{active?.label ?? "Section"}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <ul id={listId} className="hub-section-menu-pop">
          {tabs.map((t) => {
            const isActive = t.href === activeHref;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="hub-section-menu-item"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>{t.label}</span>
                  {isActive && <Check size={13} aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
