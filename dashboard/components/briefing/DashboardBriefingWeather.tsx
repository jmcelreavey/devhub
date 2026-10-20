"use client";

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { weatherIconName, type WeatherDay, type WeatherIconName, type WeatherInfo } from "@/lib/morning-briefing";
import { useGridSize, type GridSizeCategory } from "@/lib/hooks/use-grid-size";

/**
 * Dashboard-only weather hero. Visually mirrors the briefing canvas weather
 * block (large temp + location/condition + forecast chips) but is intentionally
 * separate from the AI canvas HTML — do not import canvas generators here.
 */

function forecastDayCount(size: GridSizeCategory): number {
  if (size === "1x1") return 0;
  if (size === "2x1") return 2;
  return 4;
}

const WEATHER_ICONS: Record<WeatherIconName, LucideIcon> = {
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

/** "H:17° L:9°", just the high when the low is missing, "" when neither is known. */
function highLowLabel(day: WeatherDay): string {
  if (day.highC == null) return "";
  const high = `H:${Math.round(day.highC)}°`;
  return day.lowC != null ? `${high} L:${Math.round(day.lowC)}°` : high;
}

interface DashboardBriefingWeatherProps {
  weather: WeatherInfo;
}

export function DashboardBriefingWeather({ weather }: DashboardBriefingWeatherProps) {
  const gridSize = useGridSize("briefing");
  const days = weather.days ?? [];
  if (days.length === 0) return null;

  const today = days[0];
  const forecast = days.slice(0, forecastDayCount(gridSize));
  const range = highLowLabel(today);
  const hl = range ? `  ${range}` : "";

  return (
    <div
      className="mbw-wx"
      data-size={gridSize}
      aria-label={`Weather in ${weather.location}: ${Math.round(weather.currentTempC)}°, ${today.description}`}
    >
      <div className="mbw-wx-hero">
        <div className="mbw-wx-now">
          <div className="mbw-wx-temp">{Math.round(weather.currentTempC)}°</div>
          <div className="mbw-wx-meta">
            <div className="mbw-wx-loc">{weather.location}</div>
            <div className="mbw-wx-cond">
              {today.description}
              {hl}
            </div>
          </div>
        </div>
        {forecast.length > 0 ? (
          <div className="mbw-wx-forecast" role="list" aria-label="Forecast">
            {forecast.map((d) => (
              <div key={d.date || d.label} className="mbw-wx-fday" role="listitem" title={d.description}>
                <span className="mbw-wx-fday-label">{d.label}</span>
                <span className="mbw-wx-fday-temp">{Math.round(d.highC)}°</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One-line weather for the collapsed briefing header: icon, now, condition and
 * today's range. Renders nothing when there's no forecast, so the header never
 * shows a half-empty chip. Condition and range drop out as the header narrows.
 */
export function DashboardBriefingWeatherInline({ weather }: DashboardBriefingWeatherProps) {
  const today = weather.days?.[0];
  if (!today || !Number.isFinite(weather.currentTempC)) return null;

  const Icon = WEATHER_ICONS[weatherIconName(today.code)];
  const range = highLowLabel(today);

  return (
    <span className="mbw-wx-inline" title={`${weather.location} · ${today.description}`}>
      <span className="sr-only">Weather in {weather.location}: </span>
      <Icon size={14} aria-hidden className="mbw-wx-inline-icon" />
      <span className="mbw-wx-inline-temp">{Math.round(weather.currentTempC)}°</span>
      <span className="mbw-wx-inline-cond">{today.description}</span>
      {range ? <span className="mbw-wx-inline-range">{range}</span> : null}
    </span>
  );
}
