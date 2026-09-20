"use client";

import { HoverTip } from "@/components/ui/HoverTip";
import { useLive } from "@/lib/hooks/use-fetch";
import type { NavItem } from "@/lib/nav";
import {
Activity,
BarChart3,
BookOpen,
Bot,
BrainCircuit,
CalendarDays,
Cloud,
Code2,
Database,
FileText,
FolderGit2,
GitPullRequest,
Globe,
History,
LineChart,
ListChecks,
ListTodo,
MessageSquare,
Monitor,
Newspaper,
PenTool,
Play,
Radar,
Search,
Settings2,
ShieldCheck,
Sparkles,
Terminal,
Ticket,
Zap,
type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, LucideIcon> = {
  today: CalendarDays,
  briefing: Newspaper,
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
  cursor: Code2,
  chatgpt: MessageSquare,
  antigravity: Sparkles,
  status: Activity,
  activity: History,
  skills: Zap,
  repos: FolderGit2,
  database: Database,
  own: ShieldCheck,
  radar: Radar,
  recall: BrainCircuit,
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
  const { data: activity } = useLive<{ needsAttention: number }>(item.href === "/agents" ? "/api/agent/runs?summary=1" : null, { refreshInterval: 15_000 });
  if (item.href === "/agents") count = activity?.needsAttention ?? 0;
  const pathname = usePathname();
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = ICONS[item.icon] ?? FileText;

  if (collapsed) {
    return (
      <HoverTip label={count ? `${item.label}: ${count} need attention` : item.label}>
        <Link
          href={item.href}
          onClick={onClick}
          data-active={active || undefined}
          className="nav-item-collapsed relative flex items-center justify-center mx-1 my-0.5"
        >
          <Icon size={15} strokeWidth={active ? 2 : 1.7} />
          {(unseen || count > 0) && (
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
      </HoverTip>
    );
  }

  const body = (
    <>
      {/* 2px left-rail accent for active items — grows in via .nav-rail */}
      {active && <span aria-hidden className="nav-rail" />}
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
      <Icon size={14} strokeWidth={1.8} className="nav-item-icon" />
      <span className="nav-item-label">{item.label}</span>
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
    </>
  );

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="nav-item relative flex items-center gap-2.5 overflow-hidden"
      data-active={active || undefined}
    >
      {body}
    </Link>
  );
}
