"use client";
import { NavLink } from "@/components/shell/NavLink";
import { WhatsNewPill } from "@/components/releases/ReleaseNotes";
import { IconPicker } from "@/components/ui/IconPicker";
import { BRAND_LABEL } from "@/lib/themes/brand-mark";
import { useRuntimeBrand } from "./RuntimeBrandProvider";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useIsDesktopPointer } from "@/lib/hooks/use-is-mobile";
import { useSetupStatus } from "@/lib/hooks/use-setup-status";
import { countForItem,unseenForItem,useNavBadges,type NavBadges } from "@/lib/hooks/use-nav-badges";
import { createPersistedBoolStore } from "@/lib/hooks/use-persisted-bool";
import {
NAV_GROUPS,
NAV_ITEMS,
activeNavHref,
groupSidebarNav,
sidebarEligibleNav,
type NavItem,
} from "../../../../packages/shared/ui-lib/navigation/nav";
import { usePluginNav } from "@/lib/hooks/use-plugin-nav";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ChevronLeft,ChevronRight } from "lucide-react";
import Link from "@/lib/navigation";
import { usePathname, useSearchParams } from "@/lib/navigation";
import { useEffect,useMemo } from "react";

const STORAGE_KEY = "sidebar-collapsed";
const usePersistedBool = createPersistedBoolStore("devhub:sidebar-storage");

export function CollapsibleSidebar() {
  const { brand } = useRuntimeBrand();
  const [collapsed, setCollapsed] = usePersistedBool(STORAGE_KEY);
  const isDesktop = useIsDesktopPointer();
  const pathname = usePathname();
  const search = useSearchParams();
  const pluginNav = usePluginNav();
  const pluginItems = pluginNav.items;
  const setup = useSetupStatus();

  const mounted = useClientMounted();
  const { counts, unseen, calendarRemaining, notificationsUnread } = useNavBadges();
  const navCounts = mounted ? counts : undefined;
  const navCalendarRemaining = mounted ? calendarRemaining : 0;

  useEffect(() => {
    const onToggle = () => setCollapsed((prev) => !prev);
    window.addEventListener("sidebar:toggle", onToggle);
    return () => window.removeEventListener("sidebar:toggle", onToggle);
  }, [setCollapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  const { grouped, hiddenCount } = useMemo(() => {
    const candidates = sidebarEligibleNav([...NAV_ITEMS, ...pluginItems], isDesktop);
    const groupedNav = groupSidebarNav(NAV_ITEMS, pluginItems, {
      includeDesktopOnly: isDesktop,
      setup: setup ?? null,
    });
    const visibleCount = NAV_GROUPS.reduce((count, group) => count + groupedNav[group.id].length, 0);
    return { grouped: groupedNav, hiddenCount: candidates.length - visibleCount };
  }, [isDesktop, setup, pluginItems]);

  const activeHref = activeNavHref(
    `${pathname}?${search}`,
    NAV_GROUPS.flatMap((g) => grouped[g.id].map((i) => i.href)),
    pluginItems,
  );

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
      <div className="flex items-center px-3 py-3 shrink-0 gap-1">
        {brand?.logo ? <img src={brand.logo} alt={brand.label} width={28} height={28} loading="lazy" /> : <IconPicker sidebarCollapsed={collapsed} />}
        {!collapsed && (brand?.label || BRAND_LABEL) && (
          <span
            className="font-semibold text-sm truncate"
            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
          >
            {brand?.label || BRAND_LABEL}
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
            activeHref={activeHref}
            counts={navCounts}
            unseen={unseen}
            calendarRemaining={navCalendarRemaining}
            notificationsUnread={mounted ? notificationsUnread : 0}
          />
        ))}
        {!collapsed && pluginNav.isLoading && <div className="px-4"><SkeletonRows count={1} height={24} /></div>}
        {!collapsed && pluginNav.error && <div className="px-4 py-2 text-xs text-text-muted" role="status">
          <p>{pluginNav.errorMessage}</p>
          <button type="button" className="btn btn-ghost mt-2" onClick={() => void pluginNav.mutate()}>Retry</button>
        </div>}
        {!collapsed && pluginNav.warnings.length > 0 && <Link href="/plugins" className="mx-4 block text-xs text-warning">Check plugin navigation</Link>}
        {!collapsed && setup && !setup.completed && hiddenCount > 0 && (
          <Link
            href="/setup"
            className="mx-2 mt-2 block rounded px-2 py-1.5 text-[11px] leading-snug hover:bg-[var(--bg-elevated)]"
            style={{ color: "var(--text-subtle)" }}
          >
            {hiddenCount} more {hiddenCount === 1 ? "section" : "sections"} available - finish setup
          </Link>
        )}
      </nav>

      <WhatsNewPill compact={collapsed} />

      {/* Footer - collapse toggle. Appearance lives in the top bar. */}
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
  activeHref,
  counts,
  unseen,
  calendarRemaining,
  notificationsUnread,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  activeHref: string | undefined;
  counts: NavBadges["counts"];
  unseen: NavBadges["unseen"];
  calendarRemaining: number;
  notificationsUnread: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className={collapsed ? "nav-section-collapsed py-1" : "px-2 pt-3 pb-1"}>
      {!collapsed && (
        <div className="nav-group-label">
          {label}
        </div>
      )}
      {items.map((item) => {
        const count = countForItem(item.icon, counts, { calendarRemaining, notificationsUnread });
        const hasUnseen = unseenForItem(item.icon, unseen);
        const link = (
          <NavLink
            item={item}
            collapsed={collapsed}
            active={item.href === activeHref}
            count={count}
            unseen={hasUnseen}
          />
        );
        return <div key={item.href}>{link}</div>;
      })}
    </div>
  );
}
