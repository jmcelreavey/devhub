"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import {
  Newspaper,
  CalendarDays,
  GitBranch,
  Gamepad2,
  History,
  Star,
  Lightbulb,
  MessageSquare,
  Flame,
  Droplets,
  Wind,
  Sunrise,
  Sunset,
  FerrisWheel,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  Snowflake,
  CloudLightning,
} from "lucide-react";
import { formatTime } from "@/lib/utils";
import {
  attractionMapsUrl,
  formatStars,
  weatherIconName,
  weatherTheme,
  FAMILY_ATTRACTIONS,
  type DevTip,
  type HackerNewsItem,
  type InterestSnippet,
  type LinkItem,
  type OnThisDayItem,
  type RepoItem,
  type WeatherIconName,
  type WeatherInfo,
} from "@/lib/morning-briefing";

export const WEATHER_ICONS: Record<WeatherIconName, ComponentType<{ size?: number; className?: string }>> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  "cloud-fog": CloudFog,
  "cloud-drizzle": CloudDrizzle,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  snowflake: Snowflake,
  "cloud-lightning": CloudLightning,
};

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="briefing-link today-grid-drag-cancel">
      {children}
    </a>
  );
}

/** Render a dev tip, turning `backtick` spans into <code>. */
export function renderTip(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

interface CardProps {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  extra?: ReactNode;
}

function Card({ icon, title, count, children, collapsed, onToggleCollapse, extra }: CardProps) {
  return (
    <section className="briefing-card">
      <div className="briefing-card-head">
        <span style={{ color: "var(--accent)", display: "inline-flex" }} aria-hidden>
          {icon}
        </span>
        <span className="briefing-card-title">{title}</span>
        {count !== undefined && <span className="briefing-count">{count}</span>}
        {extra}
        {onToggleCollapse && (
          <button
            type="button"
            className="briefing-collapse-btn today-grid-drag-cancel"
            onClick={onToggleCollapse}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

function ExpandableList<T>({
  items,
  render,
  initial = 6,
  className = "briefing-list",
}: {
  items: T[];
  render: (item: T, i: number) => ReactNode;
  initial?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, initial);
  return (
    <>
      <ul className={className}>{shown.map(render)}</ul>
      {items.length > initial && (
        <button
          type="button"
          className="briefing-more-btn today-grid-drag-cancel"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? (
            <>
              <ChevronUp size={12} aria-hidden /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={12} aria-hidden /> Show all {items.length}
            </>
          )}
        </button>
      )}
    </>
  );
}

export function WeatherStrip({ weather }: { weather: WeatherInfo }) {
  const days = weather.days ?? [];
  if (days.length === 0) return null;
  const todayVibe = weatherTheme(days[0].code, weather.currentTempC).vibe;

  return (
    <div>
      <div className="briefing-wx-row">
        {days.map((day, i) => {
          const isToday = i === 0;
          const temp = isToday ? weather.currentTempC : day.highC;
          const DayIcon = WEATHER_ICONS[weatherIconName(day.code)];
          return (
            <div
              key={day.date || day.label}
              className="briefing-wx-card"
              style={{ background: weatherTheme(day.code, temp).gradient }}
              title={day.description}
            >
              <span className="briefing-wx-label">{day.label}</span>
              <DayIcon size={22} className="briefing-wx-icon" />
              <span className="briefing-wx-temp">
                {Math.round(temp)}°
                {!isToday && <span className="briefing-wx-lo"> / {Math.round(day.lowC)}°</span>}
              </span>
              <span className="briefing-wx-sub">
                {isToday ? `H ${Math.round(day.highC)}° / L ${Math.round(day.lowC)}°` : day.description}
              </span>
              {day.precipProbability !== null && day.precipProbability > 0 && (
                <span className="briefing-wx-sub">
                  <Droplets size={10} className="inline mr-0.5" aria-hidden />
                  {day.precipProbability}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="briefing-wx-meta">
        <span className="briefing-chip">{weather.location}</span>
        <span className="briefing-hero-vibe">{todayVibe}</span>
        {weather.windKph !== null && (
          <span className="briefing-chip">
            <Wind size={10} aria-hidden /> {weather.windKph} km/h
          </span>
        )}
        {weather.sunrise && (
          <span className="briefing-chip">
            <Sunrise size={10} aria-hidden /> {formatTime(weather.sunrise)}
          </span>
        )}
        {weather.sunset && (
          <span className="briefing-chip">
            <Sunset size={10} aria-hidden /> {formatTime(weather.sunset)}
          </span>
        )}
      </div>
    </div>
  );
}

export function DevTipCard({ tip }: { tip: DevTip }) {
  return (
    <div className="briefing-tip">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Lightbulb size={12} style={{ color: "var(--accent)" }} aria-hidden />
        <span className="briefing-card-title">Dev tip</span>
        <span className="briefing-count" style={{ marginLeft: 0 }}>
          {tip.tag}
        </span>
        {tip.aiGenerated && (
          <span
            className="briefing-ai-badge"
            title="AI-generated for your tech stack"
          >
            <Sparkles size={9} aria-hidden /> AI
          </span>
        )}
      </div>
      <p className="text-sm leading-snug" style={{ color: "var(--text)", margin: 0 }}>
        {renderTip(tip.text)}
      </p>
    </div>
  );
}

export function AiSummaryCard({ summary }: { summary: string }) {
  return (
    <div className="briefing-ai-summary">
      <Sparkles size={12} style={{ color: "var(--accent)" }} aria-hidden />
      <p className="text-sm leading-snug" style={{ color: "var(--text)", margin: 0 }}>
        {summary}
      </p>
    </div>
  );
}

function linkItem(item: LinkItem, metaField: "meta" | "source"): ReactNode {
  const meta = metaField === "meta" ? item.meta : item.source;
  return (
    <li key={item.url} className="briefing-item">
      <ExtLink href={item.url}>{item.title}</ExtLink>
      {meta && <span className="briefing-meta"> · {meta}</span>}
    </li>
  );
}

interface PanelProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NewsPanel({ items, ...collapse }: { items: LinkItem[] } & PanelProps) {
  return (
    <Card icon={<Newspaper size={13} />} title="News" count={items.length} {...collapse}>
      <ExpandableList items={items} render={(i) => linkItem(i, "meta")} />
    </Card>
  );
}

export function EventsPanel({ items, ...collapse }: { items: LinkItem[] } & PanelProps) {
  const metaField = items.some((i) => i.meta) ? "meta" : "source";
  return (
    <Card icon={<CalendarDays size={13} />} title="Events & things to do" count={items.length} {...collapse}>
      <ExpandableList items={items} render={(i) => linkItem(i, metaField)} />
    </Card>
  );
}

export function GamingPanel({ items, ...collapse }: { items: LinkItem[] } & PanelProps) {
  return (
    <Card icon={<Gamepad2 size={13} />} title="Gaming" count={items.length} {...collapse}>
      <ExpandableList items={items} render={(i) => linkItem(i, "source")} />
    </Card>
  );
}

export function ReposPanel({ repos, ...collapse }: { repos: RepoItem[] } & PanelProps) {
  return (
    <Card icon={<GitBranch size={13} />} title="Trending repos" count={repos.length} {...collapse}>
      <ExpandableList
        items={repos}
        render={(repo) => (
          <li key={repo.url} className="briefing-item">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <ExtLink href={repo.url}>
                <span className="font-medium">{repo.name}</span>
              </ExtLink>
              <span className="briefing-meta">
                <Star size={10} className="inline mr-0.5" aria-hidden />
                {formatStars(repo.stars)}
              </span>
              {repo.language && <span className="briefing-meta">· {repo.language}</span>}
            </div>
            {repo.description && (
              <div className="text-xs leading-snug" style={{ color: "var(--text-subtle)" }}>
                {repo.description}
              </div>
            )}
          </li>
        )}
      />
    </Card>
  );
}

export function HackerNewsPanel({ items, ...collapse }: { items: HackerNewsItem[] } & PanelProps) {
  return (
    <Card icon={<Flame size={13} />} title="Hacker News" count={items.length} {...collapse}>
      <ExpandableList
        items={items}
        render={(hn) => (
          <li key={hn.commentsUrl} className="briefing-item">
            <ExtLink href={hn.url}>{hn.title}</ExtLink>
            <div className="briefing-meta flex items-center gap-2">
              <span>
                <Flame size={10} className="inline mr-0.5" aria-hidden />
                {hn.score}
              </span>
              <ExtLink href={hn.commentsUrl}>
                <span className="briefing-meta">
                  <MessageSquare size={10} className="inline mr-0.5" aria-hidden />
                  {hn.comments}
                </span>
              </ExtLink>
            </div>
          </li>
        )}
      />
    </Card>
  );
}

export function OnThisDayPanel({ items, ...collapse }: { items: OnThisDayItem[] } & PanelProps) {
  return (
    <Card icon={<History size={13} />} title="On this day" count={items.length} {...collapse}>
      <ExpandableList
        items={items}
        render={(item) => (
          <li key={`${item.year}-${item.text.slice(0, 24)}`} className="briefing-item" style={{ color: "var(--text)" }}>
            <span className="font-semibold" style={{ color: "var(--accent)" }}>
              {item.year}
            </span>{" "}
            {item.url ? <ExtLink href={item.url}>{item.text}</ExtLink> : item.text}
          </li>
        )}
      />
    </Card>
  );
}

export function AttractionsPanel({
  area = "Northern Ireland",
  ...collapse
}: { area?: string } & PanelProps) {
  return (
    <Card icon={<FerrisWheel size={13} />} title="Family days out" count={FAMILY_ATTRACTIONS.length} {...collapse}>
      <ExpandableList
        items={FAMILY_ATTRACTIONS}
        render={(a) => (
          <li key={`${a.name}-${a.area}`} className="briefing-item">
            <ExtLink href={attractionMapsUrl(a, area)}>{a.name}</ExtLink>
            <span className="briefing-meta"> · {a.area}</span>
            <span className="briefing-tagchip">{a.tag}</span>
          </li>
        )}
      />
    </Card>
  );
}

export function InterestsPanel({
  snippets,
  ...collapse
}: { snippets: InterestSnippet[] } & PanelProps) {
  return (
    <Card icon={<Sparkles size={13} />} title="Interests" count={snippets.length} {...collapse}>
      <ul className="briefing-list">
        {snippets.map((s, i) => (
          <li key={`${s.interest}-${i}`} className="briefing-item" style={{ color: "var(--text)" }}>
            <span className="briefing-tagchip" style={{ marginBottom: 2 }}>{s.interest}</span>
            <ul className="briefing-interest-links">
              {s.links.map((link) => (
                <li key={link.url}>
                  <ExtLink href={link.url}>{link.title}</ExtLink>
                  {link.source && <span className="briefing-meta"> · {link.source}</span>}
                  {link.meta && <span className="briefing-meta"> · {link.meta}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}
