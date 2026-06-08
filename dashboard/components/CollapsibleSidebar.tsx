"use client";

import { useEffect, useMemo, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { createPersistedBoolStore } from "@/lib/use-persisted-bool";
import { useLaunchChamberDesktop } from "@/lib/launch-chamber";
import { useLaunchOpenCodeDesktop } from "@/lib/launch-opencode";
import { NavLink } from "./NavLink";
import {
  NAV_ITEMS,
  NAV_GROUPS,
  filterNavBySetup,
  type NavGroup,
  type NavItem,
  type SetupGateStatus,
} from "@/lib/nav";
import { IconPicker } from "./IconPicker";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
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
  const { counts, unseen } = useNavBadges();
  const navCounts = mounted ? counts : undefined;

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
        background: "var(--bg-sidebar, #0a0d12)",
        borderRight: "1px solid var(--border-muted)",
        transition: "width 200ms ease, min-width 200ms ease",
      }}
    >
      {/* Brand */}
      <div className="flex items-center px-3 py-4 shrink-0 gap-1">
        <IconPicker sidebarCollapsed={collapsed} />
        {!collapsed && (
          <span
            className="font-semibold text-sm truncate"
            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
          >
            DevHub
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
          />
        ))}
      </nav>

      {/* Footer — collapse toggle. Theme picker lives in /setup. */}
      <div
        className="shrink-0 flex items-center justify-center"
        style={{ borderTop: "1px solid var(--border-muted)" }}
      >
        <button
          onClick={toggle}
          className="flex items-center justify-center py-2 w-full px-2"
          style={{
            color: "var(--text-subtle)",
            background: "transparent",
            cursor: "pointer",
            border: "none",
          }}
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
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  counts: NavBadges["counts"];
  unseen: NavBadges["unseen"];
}) {
  if (items.length === 0) return null;
  return (
    <div className={collapsed ? "py-1" : "px-2 pt-3 pb-1"}>
      {!collapsed && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            color: "var(--text-muted)",
            padding: "4px 10px 6px",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
      {items.map((item) => {
        const count = countForItem(item.icon, counts);
        const hasUnseen = unseenForItem(item.icon, unseen);
        const link = (
          <NavLink item={item} collapsed={collapsed} count={count} unseen={hasUnseen} />
        );
        if (!collapsed && (item.icon === "chamber" || item.icon === "opencode")) {
          return (
            <div key={item.href} style={{ position: "relative" }}>
              {link}
              <NavLaunchButton icon={item.icon} label={item.label} />
            </div>
          );
        }
        return <div key={item.href}>{link}</div>;
      })}
    </div>
  );
}

function NavLaunchButton({ icon, label }: { icon: string; label: string }) {
  const launchChamber = useLaunchChamberDesktop();
  const launchOpenCode = useLaunchOpenCodeDesktop();
  const launch = icon === "opencode" ? launchOpenCode : launchChamber;

  const handleClick = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void launch();
  };
  return (
    <button
      onClick={handleClick}
      title={`Launch ${label} Desktop`}
      aria-label={`Launch ${label} Desktop`}
      style={{
        position: "absolute",
        right: 6,
        top: "50%",
        transform: "translateY(-50%)",
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "none",
        background: "transparent",
        color: "var(--text-subtle)",
        cursor: "pointer",
        padding: 0,
        zIndex: 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--accent-dim)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-subtle)";
      }}
    >
      <Play size={11} strokeWidth={2} fill="currentColor" />
    </button>
  );
}
