"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPersistedBoolStore } from "@/lib/use-persisted-bool";
import { NavLink } from "./NavLink";
import { NavLaunchMenu } from "./NavLaunchMenu";
import {
  NAV_ITEMS,
  NAV_GROUPS,
  filterNavBySetup,
  type NavGroup,
  type NavItem,
  type SetupGateStatus,
} from "@/lib/nav";
import { IconPicker } from "./IconPicker";
import { BRAND_LABEL } from "@/lib/brand-mark";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useNavBadges, countForItem, unseenForItem, type NavBadges } from "@/lib/use-nav-badges";
import { useClientMounted } from "@/lib/use-client-mounted";

const STORAGE_KEY = "sidebar-collapsed";
const usePersistedBool = createPersistedBoolStore("devhub:sidebar-storage");

function subscribeMedia(cb: () => void) {
  const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function CollapsibleSidebar() {
  const [collapsed, setCollapsed] = usePersistedBool(STORAGE_KEY);
  const isDesktop = useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => true,
  );

  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", {
    refreshInterval: 0,
  });

  const mounted = useClientMounted();
  const { counts, unseen, calendarRemaining } = useNavBadges();
  const navCounts = mounted ? counts : undefined;
  const navCalendarRemaining = mounted ? calendarRemaining : 0;

  useEffect(() => {
    const onToggle = () => setCollapsed((prev) => !prev);
    window.addEventListener("sidebar:toggle", onToggle);
    return () => window.removeEventListener("sidebar:toggle", onToggle);
  }, [setCollapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  const grouped = useMemo(() => {
    const visible = filterNavBySetup(
      NAV_ITEMS.filter((i) => !i.desktopOnly || isDesktop),
      setup ?? null,
    );
    const map: Record<NavGroup, NavItem[]> = {
      workspace: [],
      library: [],
      system: [],
    };
    for (const item of visible) map[item.group].push(item);
    return map;
  }, [isDesktop, setup]);

  const width = collapsed ? 44 : 232;

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 h-full overflow-hidden"
      style={{
        width,
        minWidth: width,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-muted)",
        /* Snap width — Hallmark: no animated layout width */
      }}
    >
      {/* Brand */}
      <div className="flex items-center px-3 py-4 shrink-0 gap-1">
        <IconPicker sidebarCollapsed={collapsed} />
        {!collapsed && BRAND_LABEL && (
          <span
            className="font-semibold text-sm truncate"
            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
          >
            {BRAND_LABEL}
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {NAV_GROUPS.map((g) => (
          <NavSection
            key={g.id}
            label={g.label}
            items={grouped[g.id]}
            collapsed={collapsed}
            counts={navCounts}
            unseen={unseen}
            calendarRemaining={navCalendarRemaining}
          />
        ))}
      </nav>

      {/* Footer - collapse toggle. Theme picker lives in /setup. */}
      <div
        className="shrink-0 flex items-center justify-center"
        style={{ borderTop: "1px solid var(--border-muted)" }}
      >
        <button
          type="button"
          onClick={toggle}
          className="sidebar-collapse-btn"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}

function NavSection({
  label,
  items,
  collapsed,
  counts,
  unseen,
  calendarRemaining,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  counts: NavBadges["counts"];
  unseen: NavBadges["unseen"];
  calendarRemaining: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className={collapsed ? "py-1" : "px-2 pt-3 pb-1"}>
      {!collapsed && (
        <div className="nav-group-label">
          {label}
        </div>
      )}
      {items.map((item) => {
        const count = countForItem(item.icon, counts, { calendarRemaining });
        const hasUnseen = unseenForItem(item.icon, unseen);
        const link = (
          <NavLink item={item} collapsed={collapsed} count={count} unseen={hasUnseen} />
        );
        if (
          !collapsed &&
          (item.icon === "chamber" || item.icon === "opencode" || item.icon === "claude")
        ) {
          return (
            <div key={item.href} style={{ position: "relative" }}>
              {link}
              <NavLaunchMenu icon={item.icon} label={item.label} />
            </div>
          );
        }
        return <div key={item.href}>{link}</div>;
      })}
    </div>
  );
}
