import {
  Activity,
  AppWindow,
  Archive,
  ArrowRightLeft,
  Award,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Clock,
  Command,
  Compass,
  Database,
  Download,
  FileText,
  Folder,
  Gauge,
  GitBranch,
  GitFork,
  GitPullRequest,
  Hammer,
  KeyRound,
  LayoutDashboard,
  Library,
  LifeBuoy,
  ListTodo,
  Map,
  Monitor,
  MonitorSmartphone,
  NotebookPen,
  PackagePlus,
  Palette,
  PenTool,
  Plug,
  RefreshCw,
  Rocket,
  Route,
  Server,
  Settings,
  Share2,
  Smartphone,
  Sparkles,
  SquareKanban,
  SquareTerminal,
  Terminal,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { createElement } from "react";

/**
 * Icon allowlist for docs frontmatter.
 *
 * Explicit rather than a dynamic lucide lookup: importing by string name pulls
 * the entire icon set into the bundle, and an unrecognised name should fall
 * back visibly rather than crash the page.
 *
 * No brand marks — lucide dropped them in v1, so GitHub and Figma use the
 * nearest generic equivalent.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  AppWindow,
  Archive,
  ArrowRightLeft,
  Award,
  Blocks,
  BookOpen,
  Bot,
  Calendar,
  Clock,
  Command,
  Compass,
  Database,
  Download,
  FileText,
  Folder,
  Gauge,
  GitBranch,
  GitFork,
  GitPullRequest,
  Hammer,
  KeyRound,
  LayoutDashboard,
  Library,
  LifeBuoy,
  ListTodo,
  Map,
  Monitor,
  MonitorSmartphone,
  NotebookPen,
  PackagePlus,
  Palette,
  PenTool,
  Plug,
  RefreshCw,
  Rocket,
  Route,
  Server,
  Settings,
  Share2,
  Smartphone,
  Sparkles,
  SquareKanban,
  SquareTerminal,
  Terminal,
  UserRound,
  Users,
  Zap,
};

export function docIcon(name: string | undefined, fallback: LucideIcon = FileText): LucideIcon {
  if (!name) return fallback;
  return ICONS[name] ?? fallback;
}

/**
 * Render a frontmatter icon by name.
 *
 * Uses `createElement` rather than assigning to a capitalised local and putting
 * it in JSX — the React compiler lint reads that pattern as declaring a
 * component during render, which it flags (correctly, in general) as a
 * state-resetting bug.
 */
export function DocIcon({
  name,
  fallback,
  ...props
}: { name?: string; fallback?: LucideIcon } & LucideProps) {
  return createElement(docIcon(name, fallback), props);
}

/** Every valid `icon:` value, for the docs-tree integrity test. */
export const DOC_ICON_NAMES = Object.keys(ICONS);
