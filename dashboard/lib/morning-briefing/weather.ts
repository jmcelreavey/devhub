/** WMO weather codes, icons, and theme tokens for the morning briefing. */

const WEATHER_CODES: Record<number, { description: string; emoji: string }> = {
  0: { description: "Clear sky", emoji: "☀️" },
  1: { description: "Mainly clear", emoji: "🌤️" },
  2: { description: "Partly cloudy", emoji: "⛅" },
  3: { description: "Overcast", emoji: "☁️" },
  45: { description: "Fog", emoji: "🌫️" },
  48: { description: "Rime fog", emoji: "🌫️" },
  51: { description: "Light drizzle", emoji: "🌦️" },
  53: { description: "Drizzle", emoji: "🌦️" },
  55: { description: "Heavy drizzle", emoji: "🌧️" },
  56: { description: "Freezing drizzle", emoji: "🌧️" },
  57: { description: "Freezing drizzle", emoji: "🌧️" },
  61: { description: "Light rain", emoji: "🌦️" },
  63: { description: "Rain", emoji: "🌧️" },
  65: { description: "Heavy rain", emoji: "🌧️" },
  66: { description: "Freezing rain", emoji: "🌧️" },
  67: { description: "Freezing rain", emoji: "🌧️" },
  71: { description: "Light snow", emoji: "🌨️" },
  73: { description: "Snow", emoji: "❄️" },
  75: { description: "Heavy snow", emoji: "❄️" },
  77: { description: "Snow grains", emoji: "🌨️" },
  80: { description: "Light showers", emoji: "🌦️" },
  81: { description: "Showers", emoji: "🌧️" },
  82: { description: "Violent showers", emoji: "⛈️" },
  85: { description: "Snow showers", emoji: "🌨️" },
  86: { description: "Heavy snow showers", emoji: "❄️" },
  95: { description: "Thunderstorm", emoji: "⛈️" },
  96: { description: "Thunderstorm with hail", emoji: "⛈️" },
  99: { description: "Thunderstorm with hail", emoji: "⛈️" },
};

export function describeWeatherCode(code: number): { description: string; emoji: string } {
  return WEATHER_CODES[code] ?? { description: "Unknown", emoji: "🌡️" };
}

/** Stable keys the widget maps to lucide icon components (keeps the UI icon set consistent). */
export type WeatherIconName =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "cloud-fog"
  | "cloud-drizzle"
  | "cloud-rain"
  | "cloud-snow"
  | "snowflake"
  | "cloud-lightning";

export function weatherIconName(code: number): WeatherIconName {
  if (code >= 95) return "cloud-lightning";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "cloud-snow";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "snowflake";
  if (code >= 51 && code <= 55) return "cloud-drizzle";
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return "cloud-rain";
  if (code === 45 || code === 48) return "cloud-fog";
  if (code === 3) return "cloud";
  if (code === 1 || code === 2) return "cloud-sun";
  return "sun";
}

/**
 * Atmosphere band — drives CSS hooks so each day reads as a distinct sky moment.
 * Thermal first; condition modulates (warm overcast stays warm, never muddy grey).
 */
export type WeatherBand =
  | "scorch"
  | "warm"
  | "mild"
  | "fresh"
  | "crisp"
  | "bitter"
  | "overcast-warm"
  | "overcast-cool"
  | "wet-warm"
  | "wet"
  | "storm"
  | "snow"
  | "fog";

export interface WeatherTheme {
  /**
   * Layered CSS background (thermal wash). Applied inline as `background`.
   * Named `gradient` for back-compat with tests / callers.
   */
  gradient: string;
  /** Tinted sky-light for the card's top wash (`--wx-sky`). */
  sky: string;
  /** A short, playful one-liner about the day. */
  vibe: string;
  /** Semantic band for `data-band` styling hooks. */
  band: WeatherBand;
}

/** Three-stop wash — richer than a flat two-stop, still tokenized. */
function wash(a: string, b: string, c: string): string {
  return `linear-gradient(162deg, ${a} 0%, ${b} 48%, ${c} 100%)`;
}

/**
 * Atmosphere stops — temperature sets the thermal band; condition modulates.
 * Mixes stay punchy on purpose: each day should read as weather, not a pastel chip.
 * Warm days keep warning/amber even under cloud. Storms stay cool info (never accent).
 */
const MIX = {
  amberBlast: "color-mix(in oklab, var(--warning) 78%, var(--bg-elevated))",
  amberCore: "color-mix(in oklab, var(--warning) 64%, var(--bg-elevated))",
  amberMid: "color-mix(in oklab, var(--warning) 48%, var(--bg-elevated))",
  amberSoft: "color-mix(in oklab, var(--warning) 34%, var(--bg-surface))",
  amberGlow: "color-mix(in oklab, var(--warning-dim) 96%, var(--bg-elevated))",
  goldDeep: "color-mix(in oklab, var(--warning) 58%, var(--bg-overlay))",
  mildHi: "color-mix(in oklab, var(--success) 46%, var(--bg-elevated))",
  mildMid: "color-mix(in oklab, var(--success) 30%, var(--bg-elevated))",
  mildLo: "color-mix(in oklab, var(--success) 16%, var(--bg-surface))",
  skyCore: "color-mix(in oklab, var(--info) 68%, var(--bg-elevated))",
  skyMid: "color-mix(in oklab, var(--info) 48%, var(--bg-elevated))",
  skySoft: "color-mix(in oklab, var(--info) 30%, var(--bg-surface))",
  skyDeep: "color-mix(in oklab, var(--info) 62%, var(--bg-overlay))",
  slateHi: "color-mix(in oklab, var(--text-subtle) 30%, var(--bg-elevated))",
  slateMid: "color-mix(in oklab, var(--text-subtle) 18%, var(--bg-elevated))",
  mist: "color-mix(in oklab, var(--bg-overlay) 86%, var(--bg-surface))",
  ground: "color-mix(in oklab, var(--bg-elevated) 90%, transparent)",
} as const;

/** Sky-light tints — top-of-card atmospheric glow, not generic white. */
const SKY = {
  sun: "color-mix(in oklab, var(--warning) 62%, #fff)",
  warmCloud: "color-mix(in oklab, var(--warning) 42%, #fff)",
  mild: "color-mix(in oklab, var(--success) 34%, #fff)",
  cool: "color-mix(in oklab, var(--info) 52%, #fff)",
  storm: "color-mix(in oklab, var(--info) 58%, var(--bg-elevated))",
  snow: "color-mix(in oklab, var(--info) 28%, #fff)",
  fog: "color-mix(in oklab, var(--text-subtle) 22%, #fff)",
  slate: "color-mix(in oklab, var(--text-subtle) 14%, #fff)",
} as const;

function theme(
  band: WeatherBand,
  a: string,
  b: string,
  c: string,
  sky: string,
  vibe: string,
): WeatherTheme {
  return { band, gradient: wash(a, b, c), sky, vibe };
}

/**
 * Pick a mood for the weather surface from the condition code and temperature.
 * Each day gets its own atmospheric wash + sky tint so the strip reads as
 * different weather moments, not identical chips.
 */
export function weatherTheme(code: number, tempC: number): WeatherTheme {
  if (code >= 95) {
    return theme(
      "storm",
      MIX.skyDeep,
      MIX.slateHi,
      MIX.ground,
      SKY.storm,
      "Wild skies. Keep an eye out.",
    );
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return theme("snow", MIX.skyMid, MIX.skySoft, MIX.ground, SKY.snow, "Snow about. Wrap up warm.");
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    if (tempC >= 20) {
      return theme(
        "wet-warm",
        MIX.skyMid,
        MIX.amberSoft,
        MIX.mildLo,
        SKY.warmCloud,
        "Warm and wet. A grand soft day.",
      );
    }
    return theme(
      "wet",
      MIX.skyDeep,
      MIX.skyMid,
      MIX.slateMid,
      SKY.cool,
      "Bring a brolly. It's a wet one.",
    );
  }
  if (code === 45 || code === 48) {
    return theme("fog", MIX.slateHi, MIX.mist, MIX.ground, SKY.fog, "Murky and grey out there.");
  }
  // Overcast: keep the thermal band honest. Hot under cloud still reads warm
  // gold/amber, never warning-mixed-into-muted mud.
  if (code === 3) {
    if (tempC >= 25) {
      return theme(
        "overcast-warm",
        MIX.amberCore,
        MIX.amberGlow,
        MIX.goldDeep,
        SKY.warmCloud,
        "Hot under the cloud. Still a scorcher.",
      );
    }
    if (tempC >= 20) {
      return theme(
        "overcast-warm",
        MIX.amberMid,
        MIX.amberSoft,
        MIX.amberGlow,
        SKY.warmCloud,
        "Warm but grey. Soft gold light.",
      );
    }
    if (tempC >= 12) {
      return theme(
        "overcast-cool",
        MIX.slateHi,
        MIX.skySoft,
        MIX.mist,
        SKY.slate,
        "Cloud's in for the day.",
      );
    }
    return theme("overcast-cool", MIX.slateMid, MIX.mist, MIX.ground, SKY.fog, "Cool and closed-in.");
  }
  // Clear / partly cloudy — brightness scales with temp.
  if (tempC >= 25) {
    return theme(
      "scorch",
      MIX.amberBlast,
      MIX.amberCore,
      MIX.amberMid,
      SKY.sun,
      "Scorcher for here. Find some shade.",
    );
  }
  if (tempC >= 20) {
    return theme(
      "warm",
      MIX.amberCore,
      MIX.amberSoft,
      MIX.mildMid,
      SKY.sun,
      "Properly warm for NI. Get the shorts out.",
    );
  }
  if (tempC >= 15) {
    return theme(
      "mild",
      MIX.amberSoft,
      MIX.mildHi,
      MIX.mildLo,
      SKY.mild,
      "Lovely and mild. Get outside.",
    );
  }
  if (tempC >= 9) {
    return theme(
      "fresh",
      MIX.mildMid,
      MIX.skySoft,
      MIX.amberSoft,
      SKY.mild,
      "Fresh and bright. Grab a jacket.",
    );
  }
  if (tempC >= 3) {
    return theme("crisp", MIX.skyCore, MIX.skyMid, MIX.skySoft, SKY.cool, "Crisp and cold. Wrap up.");
  }
  return theme("bitter", MIX.skyDeep, MIX.skyMid, MIX.ground, SKY.cool, "Bitterly cold. Bundle up.");
}
