"use client";

import type { WeatherInfo } from "@/lib/morning-briefing";
import { useGridSize, type GridSizeCategory } from "@/lib/use-grid-size";

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

interface DashboardBriefingWeatherProps {
  weather: WeatherInfo;
}

export function DashboardBriefingWeather({ weather }: DashboardBriefingWeatherProps) {
  const gridSize = useGridSize("briefing");
  const days = weather.days ?? [];
  if (days.length === 0) return null;

  const today = days[0];
  const forecast = days.slice(0, forecastDayCount(gridSize));
  const hl =
    today.highC != null && today.lowC != null
      ? `  H:${Math.round(today.highC)}° L:${Math.round(today.lowC)}°`
      : today.highC != null
        ? `  H:${Math.round(today.highC)}°`
        : "";

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
