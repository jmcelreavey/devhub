"use client";

import { type ComponentType } from "react";
import { Droplets, Wind, Sunrise, Sunset, Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, Snowflake, CloudLightning } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { weatherIconName, weatherTheme, type WeatherIconName, type WeatherInfo } from "@/lib/morning-briefing";

// The bespoke /briefing page is now an AI-authored canvas (see app/briefing).
// The only piece still shared with the home dashboard is the weather strip used
// by MorningBriefingWidget — everything else (news/events/repos panels, the old
// sanitized bespoke fragment) was removed in the briefing refactor.

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
