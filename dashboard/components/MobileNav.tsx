"use client";

import { useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { NavLink } from "./NavLink";
import {
  NAV_ITEMS,
  NAV_GROUPS,
  filterNavBySetup,
  type NavGroup,
  type NavItem,
  type SetupGateStatus,
} from "@/lib/nav";
import { useLive } from "@/lib/use-fetch";
import { useNavBadges, countForItem, unseenForItem } from "@/lib/use-nav-badges";
import { ThemeToggle } from "./ThemeToggle";
import { AccentPicker } from "./AccentPicker";
import { FocusTimer } from "./FocusTimer";

type GroupedNav = Record<NavGroup, NavItem[]>;

/** Filter by setup gates, drop desktop-only pages, and bucket by section. */
function groupNav(items: NavItem[], setup: SetupGateStatus | null): GroupedNav {
  const visible = filterNavBySetup(
    items.filter((i) => !i.desktopOnly),
    setup,
  );
  const map: GroupedNav = { workspace: [], library: [], system: [] };
  for (const item of visible) map[item.group].push(item);
  return map;
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", {
    refreshInterval: 0,
  });
  const { counts, unseen, calendarRemaining } = useNavBadges();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Allow MobileBottomShelf "More" button to open this drawer
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("devhub:mobile-nav-open", onOpen);
    return () => window.removeEventListener("devhub:mobile-nav-open", onOpen);
  }, []);

  // Mirror the desktop sidebar exactly: the curated NAV_ITEMS, grouped by
  // section. Legacy destinations stay reachable at their URLs / via search.
  const coreGrouped = useMemo(
    () => groupNav(NAV_ITEMS, setup ?? null),
    [setup],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-1 rounded"
        style={{ color: "var(--text-muted)" }}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <Menu size={20} aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="modal-backdrop fixed inset-0 z-[9650]"
            style={{ background: "var(--scrim-strong)" }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="mobile-drawer-enter fixed inset-y-0 left-0 z-[9660] w-64 flex flex-col py-4"
            style={{ background: "var(--bg-sidebar, #0a0d12)", borderRight: "1px solid var(--border)" }}
          >
            <div
              className="px-4 pb-3 mb-1 border-b font-semibold text-sm"
              style={{ borderColor: "var(--border-muted)" }}
            >
              DevHub
            </div>
            <nav className="flex-1 overflow-y-auto px-2">
              {NAV_GROUPS.map((g) =>
                coreGrouped[g.id].length === 0 ? null : (
                  <div key={g.id} className="pt-3 pb-1">
                    <div className="nav-group-label">{g.label}</div>
                    {coreGrouped[g.id].map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        onClick={() => setOpen(false)}
                        count={countForItem(item.icon, counts, { calendarRemaining })}
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
                aria-label="Settings"
                className="flex items-center gap-0.5"
              >
                <FocusTimer />
                <ThemeToggle />
                <AccentPicker />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
