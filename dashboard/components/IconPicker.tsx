"use client";

import {
  useState,
  useEffect,
  useCallback,
  createElement,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type SVGProps,
} from "react";
import Image from "next/image";
import {
  BRAND_BOTTLE_IMAGE_SRC,
  BRAND_LABEL,
  DEVHUB_BRAND_IMAGE,
  DEVHUB_BRAND_LABEL,
  HAS_PLUGIN_BRAND,
} from "@/lib/brand-mark";
import { getSeasonalEntry, getCurrentSeasonalEntries } from "@/lib/seasonal";
import {
  decodePinnedGlyph,
  encodePinnedGlyph,
  isFullColorGlyphStored,
  isPinnedGlyphStored,
  pinnedGlyphMatchesEntry,
} from "@/lib/icon-storage";
import { SeasonalMark } from "@/components/icons/SeasonalMark";
import { isSeasonalMarkId } from "@/lib/seasonal-mark-ids";
import {
  Rocket,
  Terminal,
  Code2,
  Zap,
  Flame,
  Layers,
  Hexagon,
  Diamond,
  Star,
  Sparkles,
  Dices,
  Globe,
  Compass,
  Sun,
  Moon,
  Command,
  GitBranch,
  Activity,
  Cpu,
  Database,
  Server,
  Shield,
  Fingerprint,
  Brain,
  Bot,
  Eye,
  Ghost,
  Heart,
  FlameKindling,
  Mountain,
  TreePine,
  Waves,
  Cloud,
  Snowflake,
  Flower,
  Sprout,
  Leaf,
  Gift,
  PartyPopper,
  Bird,
  Cat,
  Dog,
  Beaker,
  Atom,
  SatelliteDish,
  Radar,
  Monitor,
  Laptop,
  Keyboard,
  Gamepad2,
  Headphones,
  Camera,
  Lightbulb,
  Palette,
  Paintbrush,
  PenTool,
  Music,
  Guitar,
  Crown,
  Trophy,
  Target,
  Swords,
  Flag,
  Bookmark,
  MapPin,
  Anchor,
  Sailboat,
  Plane,
  Car,
  Wrench,
  Hammer,
  Bolt,
  Settings,
  Puzzle,
  Package,
  Box,
  LayoutDashboard,
  Gauge,
  Timer,
  AlarmClock,
  CalendarDays,
  Bell,
  MessageSquare,
  Phone,
  Workflow,
  GitMerge,
  GitPullRequest,
  CircleUser,
  Users,
  BadgeCheck,
} from "lucide-react";

/** Sidebar brand: Lucide icon inside the accent chip */
const BRAND_LUCIDE_PX = 24;
const BRAND_LUCIDE_COLLAPSED_PX = 17;
/** Transparent bottle mark: needs larger on-screen size or fizz bubbles disappear when downscaled */
const BRAND_BOTTLE_MARK_EXPANDED_PX = 48;
const BRAND_BOTTLE_MARK_COLLAPSED_PX = 28;
/** Sidebar brand: full-color seasonal mark (SVG or emoji) — fits inside `.brand-dot[data-full-icon]` */
const BRAND_GLYPH_MARK_PX = 40;
const BRAND_GLYPH_EMOJI_PX = 34;
/** Narrow sidebar rail — keep glyph legible without clipping */
const BRAND_GLYPH_MARK_COLLAPSED_PX = 26;
const BRAND_GLYPH_EMOJI_COLLAPSED_PX = 22;
/** Icon picker seasonal row previews (40px tiles) */
const PICKER_GLYPH_MARK_PX = 26;
const PICKER_GLYPH_EMOJI_PX = 22;

function SeasonalGlyphVisual({
  emoji,
  markId,
  markPixels,
  emojiPixels,
}: {
  emoji?: string;
  markId?: string;
  markPixels: number;
  emojiPixels: number;
}) {
  if (markId && isSeasonalMarkId(markId)) {
    return <SeasonalMark id={markId} size={markPixels} />;
  }
  if (emoji) {
    return (
      <span
        style={{
          fontSize: `${emojiPixels}px`,
          lineHeight: 1,
          display: "inline-block",
        }}
      >
        {emoji}
      </span>
    );
  }
  return null;
}

function seasonalEntryUsesFullColorGlyph(entry: {
  fullIcon?: boolean;
  emoji?: string;
  markId?: string;
} | null): boolean {
  return Boolean(entry?.fullIcon && (entry.emoji || (entry.markId && isSeasonalMarkId(entry.markId))));
}

type LucideIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const ICON_OPTIONS: { label: string; Icon: LucideIconComponent }[] = [
  { label: "Rocket", Icon: Rocket },
  { label: "Terminal", Icon: Terminal },
  { label: "Code", Icon: Code2 },
  { label: "Zap", Icon: Zap },
  { label: "Flame", Icon: Flame },
  { label: "Layers", Icon: Layers },
  { label: "Hexagon", Icon: Hexagon },
  { label: "Diamond", Icon: Diamond },
  { label: "Star", Icon: Star },
  { label: "Sparkles", Icon: Sparkles },
  { label: "Globe", Icon: Globe },
  { label: "Compass", Icon: Compass },
  { label: "Sun", Icon: Sun },
  { label: "Moon", Icon: Moon },
  { label: "Command", Icon: Command },
  { label: "GitBranch", Icon: GitBranch },
  { label: "Activity", Icon: Activity },
  { label: "Cpu", Icon: Cpu },
  { label: "Database", Icon: Database },
  { label: "Server", Icon: Server },
  { label: "Shield", Icon: Shield },
  { label: "Fingerprint", Icon: Fingerprint },
  { label: "Brain", Icon: Brain },
  { label: "Bot", Icon: Bot },
  { label: "Eye", Icon: Eye },
  { label: "Ghost", Icon: Ghost },
  { label: "Heart", Icon: Heart },
  { label: "Flame Kindling", Icon: FlameKindling },
  { label: "Mountain", Icon: Mountain },
  { label: "Tree", Icon: TreePine },
  { label: "Waves", Icon: Waves },
  { label: "Cloud", Icon: Cloud },
  { label: "Snowflake", Icon: Snowflake },
  { label: "Flower", Icon: Flower },
  { label: "Sprout", Icon: Sprout },
  { label: "Leaf", Icon: Leaf },
  { label: "Gift", Icon: Gift },
  { label: "PartyPopper", Icon: PartyPopper },
  { label: "Bird", Icon: Bird },
  { label: "Cat", Icon: Cat },
  { label: "Dog", Icon: Dog },
  { label: "Beaker", Icon: Beaker },
  { label: "Atom", Icon: Atom },
  { label: "Satellite", Icon: SatelliteDish },
  { label: "Radar", Icon: Radar },
  { label: "Monitor", Icon: Monitor },
  { label: "Laptop", Icon: Laptop },
  { label: "Keyboard", Icon: Keyboard },
  { label: "Gamepad", Icon: Gamepad2 },
  { label: "Headphones", Icon: Headphones },
  { label: "Camera", Icon: Camera },
  { label: "Lightbulb", Icon: Lightbulb },
  { label: "Palette", Icon: Palette },
  { label: "Paintbrush", Icon: Paintbrush },
  { label: "Pen Tool", Icon: PenTool },
  { label: "Music", Icon: Music },
  { label: "Guitar", Icon: Guitar },
  { label: "Crown", Icon: Crown },
  { label: "Trophy", Icon: Trophy },
  { label: "Target", Icon: Target },
  { label: "Swords", Icon: Swords },
  { label: "Flag", Icon: Flag },
  { label: "Bookmark", Icon: Bookmark },
  { label: "MapPin", Icon: MapPin },
  { label: "Anchor", Icon: Anchor },
  { label: "Sailboat", Icon: Sailboat },
  { label: "Plane", Icon: Plane },
  { label: "Car", Icon: Car },
  { label: "Wrench", Icon: Wrench },
  { label: "Hammer", Icon: Hammer },
  { label: "Bolt", Icon: Bolt },
  { label: "Settings", Icon: Settings },
  { label: "Puzzle", Icon: Puzzle },
  { label: "Package", Icon: Package },
  { label: "Cube", Icon: Box },
  { label: "Layout Dashboard", Icon: LayoutDashboard },
  { label: "Gauge", Icon: Gauge },
  { label: "Timer", Icon: Timer },
  { label: "Alarm Clock", Icon: AlarmClock },
  { label: "Calendar", Icon: CalendarDays },
  { label: "Bell", Icon: Bell },
  { label: "Message", Icon: MessageSquare },
  { label: "Phone", Icon: Phone },
  { label: "Workflow", Icon: Workflow },
  { label: "Git Merge", Icon: GitMerge },
  { label: "Git PR", Icon: GitPullRequest },
  { label: "User", Icon: CircleUser },
  { label: "Users", Icon: Users },
  { label: "Badge", Icon: BadgeCheck },
];

const STORAGE_KEY = "devhub-logo-icon";
const DEFAULT_ICON = "Terminal";
const SEASONAL_VALUE = "__seasonal__";
/**
 * Sentinel for the brand's "DevHub bottle" PWA mark. This is the out-of-box
 * default — users only see another icon if they pick one in the popover, and
 * the Reset button restores this value.
 */
const BOTTLE_VALUE = "__bottle__";
/**
 * Sentinel for the stock DevHub bottle mark. Only meaningful when a branding plugin is
 * active: BOTTLE_VALUE then renders the whitelabel logo (the out-of-box default), and
 * DEVHUB_VALUE lets the user explicitly switch back to the original DevHub mark.
 */
const DEVHUB_VALUE = "__devhub__";
const ICON_EVENT = "devhub:icon-change";

function isDevhubStored(stored: string): boolean {
  return stored === DEVHUB_VALUE;
}

let clientMounted = false;

function subscribeHydrated(cb: () => void) {
  const id = window.setTimeout(() => {
    clientMounted = true;
    cb();
  }, 0);
  return () => {
    window.clearTimeout(id);
    clientMounted = false;
  };
}

function getHydratedSnapshot(): boolean {
  return clientMounted;
}

function useHydrated(): boolean {
  return useSyncExternalStore(subscribeHydrated, getHydratedSnapshot, () => false);
}

function isBottleStored(stored: string): boolean {
  return stored === BOTTLE_VALUE;
}

function getContrastIconColor(): string {
  if (typeof window === "undefined") return "#ffffff";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const rgb = parseColorToRgb(accent);
  if (!rgb) return "#ffffff";
  const whiteContrast = contrastRatio(rgb, [255, 255, 255]);
  const darkContrast = contrastRatio(rgb, [13, 17, 23]);
  return darkContrast >= whiteContrast ? "#0d1117" : "#ffffff";
}

function parseColorToRgb(input: string): [number, number, number] | null {
  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3) {
      return [
        parseInt(raw[0] + raw[0], 16),
        parseInt(raw[1] + raw[1], 16),
        parseInt(raw[2] + raw[2], 16),
      ];
    }
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  const rgb = input.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

function channelToLinear(v: number): number {
  const n = v / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function getStoredIconName(): string {
  if (typeof window === "undefined") return BOTTLE_VALUE;
  return localStorage.getItem(STORAGE_KEY) ?? BOTTLE_VALUE;
}

function setStoredIconName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name);
  window.dispatchEvent(new Event(ICON_EVENT));
}

function resetStoredIconName(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(ICON_EVENT));
}

function subscribeIcon(cb: () => void) {
  window.addEventListener(ICON_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(ICON_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Reactive hook — re-renders when the user picks a new icon anywhere. */
export function useIconName(): string {
  return useSyncExternalStore(subscribeIcon, getStoredIconName, () => BOTTLE_VALUE);
}

/**
 * Resolve a stored selection to a concrete lucide icon name. When the user
 * has chosen "seasonal" (the default), this consults the date-driven table
 * and falls back to the default icon outside of any seasonal window.
 */
export function resolveIconName(stored: string, now: Date = new Date()): string {
  if (isBottleStored(stored) || isDevhubStored(stored)) return DEFAULT_ICON;
  if (isPinnedGlyphStored(stored)) {
    const g = decodePinnedGlyph(stored);
    return g?.icon ?? DEFAULT_ICON;
  }
  if (stored !== SEASONAL_VALUE) return stored;
  const seasonal = getSeasonalEntry(now);
  return seasonal?.icon ?? DEFAULT_ICON;
}

export function getIconComponent(name: string): LucideIconComponent | null {
  return ICON_OPTIONS.find((o) => o.label === name)?.Icon ?? null;
}

export function IconPicker({
  onSelect,
  sidebarCollapsed = false,
}: {
  onSelect?: () => void;
  /** When true, shrink the colorful logo so it fits the 52px collapsed rail */
  sidebarCollapsed?: boolean;
}) {
  const storedSelected = useIconName();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = hydrated ? storedSelected : BOTTLE_VALUE;
  const renderCollapsed = hydrated ? sidebarCollapsed : false;
  const bottleSelected = isBottleStored(selected);
  const devhubSelected = isDevhubStored(selected);
  const activeSeasonal = selected === SEASONAL_VALUE ? getSeasonalEntry() : null;
  const isFullSeasonalIcon = Boolean(
    seasonalEntryUsesFullColorGlyph(activeSeasonal) || isFullColorGlyphStored(selected),
  );
  const isFullColorBrandIcon = isFullSeasonalIcon || bottleSelected || devhubSelected;

  const pick = useCallback(
    (name: string) => {
      setStoredIconName(name);
      setOpen(false);
      setSearch("");
      onSelect?.();
    },
    [onSelect]
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const filtered = search
    ? ICON_OPTIONS.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : ICON_OPTIONS;

  const seasonalEntry = getSeasonalEntry();
  const currentSeasonal = getCurrentSeasonalEntries();
  const seasonalActive = selected === SEASONAL_VALUE;

  const seasonalIconButtons = currentSeasonal
    .map((s) => {
      const comp = getIconComponent(s.icon);
      return comp
        ? {
            label: s.label,
            Icon: comp,
            iconName: s.icon,
            emoji: s.emoji,
            fullIcon: s.fullIcon,
            markId: s.markId,
            entry: s,
          }
        : null;
    })
    .filter(Boolean) as {
    label: string;
    Icon: LucideIconComponent;
    iconName: string;
    emoji?: string;
    fullIcon?: boolean;
    markId?: string;
    entry: import("@/lib/seasonal").SeasonalEntry;
  }[];

  return (
    <div style={{ position: "relative" }}>
      <button
        className="brand-dot flex items-center justify-center shrink-0"
        data-full-icon={isFullColorBrandIcon ? "true" : undefined}
        style={renderCollapsed ? { width: 30, height: 30, borderRadius: 8 } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        title="Change app icon"
        aria-label="Change app icon"
      >
        <LogoIcon
          size={renderCollapsed ? BRAND_LUCIDE_COLLAPSED_PX : BRAND_LUCIDE_PX}
          glyphMarkPx={renderCollapsed ? BRAND_GLYPH_MARK_COLLAPSED_PX : BRAND_GLYPH_MARK_PX}
          glyphEmojiPx={renderCollapsed ? BRAND_GLYPH_EMOJI_COLLAPSED_PX : BRAND_GLYPH_EMOJI_PX}
        />
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 199 }}
            onClick={() => { setOpen(false); setSearch(""); }}
          />
          <div
            style={{
              position: "fixed",
              top: "56px",
              left: "8px",
              width: "320px",
              maxHeight: "480px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              zIndex: 200,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            {/* Brand section — only when a plugin whitelabels the logo, so the user can
                flip between the brand mark and the stock DevHub mark. */}
            {!search && HAS_PLUGIN_BRAND && (
              <div style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ padding: "8px 12px 4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Brand
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", padding: "4px 12px 10px" }}>
                  {[
                    { value: BOTTLE_VALUE, src: BRAND_BOTTLE_IMAGE_SRC, label: BRAND_LABEL || "Brand", active: bottleSelected },
                    { value: DEVHUB_VALUE, src: DEVHUB_BRAND_IMAGE, label: DEVHUB_BRAND_LABEL, active: devhubSelected },
                  ].map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); pick(b.value); }}
                      title={`Use the ${b.label} logo`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 10px 6px 6px",
                        borderRadius: "8px",
                        border: b.active ? "2px solid var(--accent)" : "2px solid transparent",
                        background: b.active ? "var(--accent-dim)" : "var(--bg-surface)",
                        color: "var(--text)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Image src={b.src} alt="" aria-hidden unoptimized width={28} height={28} style={{ width: 28, height: 28, borderRadius: 6, display: "block" }} />
                      <span style={{ fontSize: "12px", fontWeight: 500 }}>{b.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Seasonal section */}
            {!search && (
              <div style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px 4px",
                  }}
                >
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Seasonal
                  </span>
                  {seasonalEntry && (
                    <span style={{ fontSize: "11px", color: "var(--accent)" }}>
                      Now: {seasonalEntry.label}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    padding: "4px 12px 10px",
                    overflowX: "auto",
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); pick(SEASONAL_VALUE); }}
                    title="Auto: calendar seasonal look (changes daily when multiple options exist)"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "40px",
                      height: "40px",
                      borderRadius: "6px",
                      border: seasonalActive ? "2px solid var(--accent)" : "2px solid transparent",
                      background: seasonalActive ? "var(--accent-dim)" : "var(--bg-surface)",
                      color: seasonalActive ? "var(--accent)" : "var(--text-subtle)",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Dices size={18} />
                  </button>
                  {seasonalIconButtons.map((s) => {
                    const pinnedSel = pinnedGlyphMatchesEntry(selected, s.entry);
                    return (
                      <button
                        key={`${s.label}-${s.emoji ?? ""}-${s.markId ?? ""}-${s.iconName}`}
                        type="button"
                        title={s.label}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (s.fullIcon && (s.emoji || s.markId)) {
                            pick(
                              encodePinnedGlyph({
                                icon: s.iconName,
                                label: s.label,
                                emoji: s.emoji ?? "",
                                markId: s.markId,
                              }),
                            );
                          } else {
                            pick(s.iconName);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "40px",
                          height: "40px",
                          borderRadius: "6px",
                          border: pinnedSel ? "2px solid var(--accent)" : "2px solid transparent",
                          background: pinnedSel ? "var(--accent-dim)" : "var(--bg-surface)",
                          color: pinnedSel ? "var(--accent)" : "var(--text-subtle)",
                          cursor: "pointer",
                          padding: 0,
                          flexShrink: 0,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!pinnedSel) {
                            e.currentTarget.style.background = "var(--bg-elevated)";
                            e.currentTarget.style.color = "var(--text)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!pinnedSel) {
                            e.currentTarget.style.background = "var(--bg-surface)";
                            e.currentTarget.style.color = "var(--text-subtle)";
                          }
                        }}
                      >
                        {s.fullIcon && (s.emoji || s.markId) ? (
                          <SeasonalGlyphVisual
                            emoji={s.emoji}
                            markId={s.markId}
                            markPixels={PICKER_GLYPH_MARK_PX}
                            emojiPixels={PICKER_GLYPH_EMOJI_PX}
                          />
                        ) : (
                          <s.Icon size={18} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ padding: "8px", borderBottom: "1px solid var(--border)" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-subtle)" }}>
                  Icon
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: "11px", padding: "2px 8px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetStoredIconName();
                    setOpen(false);
                    setSearch("");
                    onSelect?.();
                  }}
                  title="Reset to default bottle icon"
                >
                  Reset default
                </button>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search icons..."
                autoFocus
                style={{
                  width: "100%",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  color: "var(--text)",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: "2px",
                padding: "8px",
                overflowY: "auto",
                flex: 1,
              }}
            >
              {filtered.map((opt) => {
                const isSelected =
                  opt.label === selected ||
                  (isPinnedGlyphStored(selected) && decodePinnedGlyph(selected)?.icon === opt.label);
                return (
                  <button
                    key={opt.label}
                    title={opt.label}
                    onClick={(e) => { e.stopPropagation(); pick(opt.label); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "44px",
                      height: "44px",
                      borderRadius: "6px",
                      border: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                      background: isSelected ? "var(--accent-dim)" : "transparent",
                      color: isSelected ? "var(--accent)" : "var(--text-subtle)",
                      cursor: "pointer",
                      padding: 0,
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = "var(--bg-surface)";
                        e.currentTarget.style.color = "var(--text)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-subtle)";
                      }
                    }}
                  >
                    <opt.Icon size={20} />
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    textAlign: "center",
                    padding: "24px 0",
                    color: "var(--text-subtle)",
                    fontSize: "13px",
                  }}
                >
                  No icons found
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function LogoIcon({
  size,
  glyphMarkPx = BRAND_GLYPH_MARK_PX,
  glyphEmojiPx = BRAND_GLYPH_EMOJI_PX,
}: {
  size?: number;
  glyphMarkPx?: number;
  glyphEmojiPx?: number;
}) {
  const rawStored = useIconName();
  const hydrated = useHydrated();
  const stored = hydrated ? rawStored : BOTTLE_VALUE;
  const lucidePx = size ?? BRAND_LUCIDE_PX;
  const [iconColor, setIconColor] = useState<string>("#ffffff");

  useEffect(() => {
    const syncColor = () => setIconColor(getContrastIconColor());
    const id = window.setTimeout(syncColor, 0);
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      syncColor();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.clearTimeout(id);
      observer.disconnect();
    };
  }, []);

  const glyphProps = { markPixels: glyphMarkPx, emojiPixels: glyphEmojiPx };

  if (isBottleStored(stored) || isDevhubStored(stored)) {
    const bottlePx =
      lucidePx <= BRAND_LUCIDE_COLLAPSED_PX
        ? BRAND_BOTTLE_MARK_COLLAPSED_PX
        : BRAND_BOTTLE_MARK_EXPANDED_PX;
    // BOTTLE_VALUE = the active brand (whitelabel logo if a plugin set one); DEVHUB_VALUE
    // = always the stock DevHub mark.
    const brandSrc = isDevhubStored(stored) ? DEVHUB_BRAND_IMAGE : BRAND_BOTTLE_IMAGE_SRC;
    return (
      <Image
        src={brandSrc}
        alt=""
        aria-hidden
        unoptimized
        width={bottlePx}
        height={bottlePx}
        style={{
          width: bottlePx,
          height: bottlePx,
          display: "block",
          borderRadius: 8,
        }}
      />
    );
  }

  if (isPinnedGlyphStored(stored) && isFullColorGlyphStored(stored)) {
    const pinned = decodePinnedGlyph(stored);
    if (pinned) {
      return (
        <span
          aria-label={pinned.label}
          title={pinned.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            transform: "translateY(0.5px)",
          }}
        >
          <SeasonalGlyphVisual emoji={pinned.emoji} markId={pinned.markId} {...glyphProps} />
        </span>
      );
    }
  }

  const seasonal = stored === SEASONAL_VALUE ? getSeasonalEntry() : null;
  if (seasonal && seasonalEntryUsesFullColorGlyph(seasonal)) {
    return (
      <span
        aria-label={seasonal.label}
        title={seasonal.label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          transform: "translateY(0.5px)",
        }}
      >
        <SeasonalGlyphVisual emoji={seasonal.emoji} markId={seasonal.markId} {...glyphProps} />
      </span>
    );
  }

  const resolved = resolveIconName(stored);
  const Icon = getIconComponent(resolved);
  const props = { size: lucidePx, style: { color: iconColor } as CSSProperties };
  if (Icon) return createElement(Icon, props);
  return createElement(Terminal, props);
}
