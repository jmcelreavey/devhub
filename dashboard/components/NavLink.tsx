"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FileText,
  Activity,
  Zap,
  FolderGit2,
  Play,
  Monitor,
  Ticket,
  Settings2,
  Search,
  BookOpen,
  LineChart,
  ListTodo,
  GitPullRequest,
  Cloud,
  PenTool,
  Terminal,
  ListChecks,
  BarChart3,
  Globe,
  Bot,
  Sparkles,
  Radar,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  today: CalendarDays,
  briefing: Sparkles,
  calendar: CalendarDays,
  tickets: Ticket,
  notes: FileText,
  docs: BookOpen,
  shared: Globe,
  diagrams: PenTool,
  search: Search,
  learnings: BookOpen,
  chamber: Monitor,
  opencode: Terminal,
  claude: Bot,
  status: Activity,
  skills: Zap,
  repos: FolderGit2,
  radar: Radar,
  actions: Play,
  setup: Settings2,
  datadog: LineChart,
  ops: Cloud,
  tasks: ListTodo,
  review: BarChart3,
  prs: GitPullRequest,
  checklists: ListChecks,
};

const UNSEEN_COLOR = "var(--info)";

const MONO_FONT = "var(--font-mono, 'JetBrains Mono', monospace)";

interface Props {
  item: NavItem;
  onClick?: () => void;
  collapsed?: boolean;
  /** Queue depth badge — only shown when > 0 */
  count?: number;
  /** New activity seen on another surface since this route was last visited. */
  unseen?: boolean;
}

export function NavLink({ item, onClick, collapsed, count = 0, unseen = false }: Props) {
  const pathname = usePathname();
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = ICONS[item.icon] ?? FileText;

  if (collapsed) {
    return (
      <Link
        href={item.href}
        onClick={onClick}
        className="relative flex items-center justify-center mx-1 my-0.5 rounded-md transition-colors"
        style={{
          height: 32,
          color: active ? "var(--text)" : "var(--text-muted)",
          background: active ? "var(--accent-dim)" : "transparent",
          boxShadow: active
            ? "inset 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent)"
            : "none",
        }}
        data-tooltip={item.label}
      >
        <Icon size={15} strokeWidth={active ? 2 : 1.7} />
        {unseen && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: UNSEEN_COLOR,
            }}
          />
        )}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="nav-item relative flex items-center gap-2.5 overflow-hidden"
      data-active={active || undefined}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 13,
        color: active ? "var(--text)" : "var(--text-muted)",
        background: active ? "var(--accent-dim)" : "transparent",
        boxShadow: active ? "inset 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent)" : "none",
      }}
    >
      {/* 2px left-rail accent for active items - grows in via .nav-rail */}
      {active && (
        <span
          aria-hidden
          className="nav-rail"
          style={{
            position: "absolute",
            left: 0,
            top: 4,
            bottom: 4,
            width: 2,
            borderRadius: 1,
            background: "var(--accent)",
          }}
        />
      )}
      {/* Unseen activity dot at left edge (non-active rows). */}
      {unseen && !active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 3,
            top: "50%",
            transform: "translateY(-50%)",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: UNSEEN_COLOR,
            flexShrink: 0,
          }}
        />
      )}
      <Icon size={14} strokeWidth={1.8} style={{ opacity: active ? 0.95 : 0.75 }} />
      <span style={{ fontWeight: active ? 600 : 500 }}>{item.label}</span>
      <span className="flex-1" />
      {/* Count badge - only when > 0 */}
      {count > 0 && (
        <span
          style={{
            fontFamily: MONO_FONT,
            fontSize: 10.5,
            fontVariantNumeric: "tabular-nums",
            color: "var(--text-subtle)",
            lineHeight: 1,
            paddingRight: 2,
          }}
        >
          {count}
        </span>
      )}
      {/* Keyboard shortcut hint */}
      {item.shortcut && count === 0 && (
        <span
          style={{
            fontFamily: MONO_FONT,
            fontSize: 9.5,
            opacity: 0.6,
            color: "var(--text-subtle)",
          }}
        >
          {item.shortcut}
        </span>
      )}
    </Link>
  );
}
