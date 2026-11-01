"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePathname, useSearchParams } from "@/lib/navigation";
import Link from "@/lib/navigation";
import { Menu, X } from "lucide-react";
import { NavLink } from "@/components/shell/NavLink";
import {
  NAV_ITEMS,
  NAV_GROUPS,
  activeNavHref,
  groupSidebarNav,
  type NavGroup,
  type NavItem,
} from "../../../../packages/shared/ui-lib/navigation/nav";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { usePluginNav } from "@/lib/hooks/use-plugin-nav";
import { useSetupStatus } from "@/lib/hooks/use-setup-status";
import { useNavBadges, countForItem, unseenForItem } from "@/lib/hooks/use-nav-badges";
import { AccentPicker } from "@/components/shell/AccentPicker";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { HoverTip } from "@/components/ui/HoverTip";

type GroupedNav = Record<NavGroup, NavItem[]>;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const setup = useSetupStatus();
  const pluginNav = usePluginNav();
  const pluginItems = pluginNav.items;
  const pathname = usePathname();
  const search = useSearchParams();
  const { counts, unseen, calendarRemaining, notificationsUnread } = useNavBadges();

  useEffect(() => {
    if (!open) return;
    const main = document.getElementById("main-content");
    const trigger = triggerRef.current;
    const previousOverflow = main?.style.overflow;
    if (main) main.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && drawerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (main) main.style.overflow = previousOverflow ?? "";
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex=\"-1\"])",
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  // Mirror the desktop sidebar: core NAV_ITEMS + plugin contributions, grouped
  // by section. Legacy destinations stay reachable at their URLs / via search.
  const coreGrouped: GroupedNav = useMemo(
    () =>
      groupSidebarNav(NAV_ITEMS, pluginItems, {
        includeDesktopOnly: false,
        setup: setup ?? null,
      }),
    [setup, pluginItems],
  );
  const activeHref = activeNavHref(
    `${pathname}?${search}`,
    NAV_GROUPS.flatMap((g) => coreGrouped[g.id].map((i) => i.href)),
    pluginItems,
  );

  return (
    <>
      <HoverTip label="Open menu" pos="bottom-start">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-11 min-h-11 grid place-items-center rounded text-text-muted"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
        >
          <Menu size={20} aria-hidden />
        </button>
      </HoverTip>

      {open && (
        <>
          <div
            className="modal-backdrop fixed inset-0 z-[9650]"
            style={{ background: "var(--scrim-strong)" }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="mobile-drawer-enter fixed inset-y-0 left-0 z-[9660] w-64 flex flex-col py-4"
            style={{ background: "var(--bg-sidebar, #0a0d12)", borderRight: "1px solid var(--border)" }}
            onKeyDown={trapFocus}
          >
            <div
              className="px-4 pb-3 mb-1 border-b font-semibold text-sm flex items-center justify-between"
              style={{ borderColor: "var(--border-muted)" }}
            >
              <span>DevHub</span>
              <HoverTip label="Close menu" pos="bottom-end">
                <button type="button" className="hub-icon-btn min-w-11 min-h-11" aria-label="Close menu" onClick={() => setOpen(false)}>
                  <X size={16} aria-hidden />
                </button>
              </HoverTip>
            </div>
            <nav className="flex-1 overflow-y-auto px-2">
              {pluginNav.isLoading && <SkeletonRows count={1} height={24} />}
              {pluginNav.error && <div className="px-2 py-2 text-xs text-text-muted" role="status">
                <p>{pluginNav.errorMessage}</p>
                <button type="button" className="btn btn-ghost mt-2" onClick={() => void pluginNav.mutate()}>Retry</button>
              </div>}
              {pluginNav.warnings.length > 0 && <Link href="/plugins" className="block text-xs text-warning">Check plugin navigation</Link>}
              {NAV_GROUPS.map((g) =>
                coreGrouped[g.id].length === 0 ? null : (
                  <div key={g.id} className="pt-3 pb-1">
                    <div className="nav-group-label">{g.label}</div>
                    {coreGrouped[g.id].map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        onClick={() => setOpen(false)}
                        active={item.href === activeHref}
                        count={countForItem(item.icon, counts, { calendarRemaining, notificationsUnread })}
                        unseen={unseenForItem(item.icon, unseen)}
                      />
                    ))}
                  </div>
                ),
              )}
            </nav>
            <div
              className="shrink-0 px-4 pt-3 mt-1 border-t flex flex-col gap-2"
              style={{ borderColor: "var(--border-muted)" }}
            >
              <div
                role="group"
                aria-label="Preferences"
                className="flex items-center gap-0.5"
              >
                <FocusTimer />
                      <AccentPicker />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
