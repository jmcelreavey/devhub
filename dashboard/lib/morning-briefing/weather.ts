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

export interface WeatherTheme {
  /** CSS gradient for the hero background (semi-transparent so it works in both themes). */
  gradient: string;
  /** A short, playful one-liner about the day. */
  vibe: string;
}

/**
 * Pick a mood for the weather hero from the condition code and temperature.
 * Gradients use rgba overlays over the card surface, so they read well in light
 * and dark mode without hard-coding theme colours.
 */
export function weatherTheme(code: number, tempC: number): WeatherTheme {
  // Vivid three-stop diagonal blends. Alphas are high enough to read as real
  // colour in both light and dark mode while staying behind the card text.
  const g = (from: string, mid: string, to: string) =>
    `linear-gradient(135deg, ${from} 0%, ${mid} 55%, ${to} 100%)`;

  // Thunderstorm — electric violet → indigo.
  if (code >= 95) {
    return {
      gradient: g("rgba(167,123,255,0.62)", "rgba(110,80,210,0.42)", "rgba(60,45,120,0.30)"),
      vibe: "Wild skies — keep an eye out.",
    };
  }
  // Snow — icy cyan → white-blue.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return {
      gradient: g("rgba(120,205,250,0.60)", "rgba(170,225,250,0.40)", "rgba(232,245,252,0.30)"),
      vibe: "Snow about — wrap up warm.",
    };
  }
  // Rain / drizzle / showers. A warm wet day blends blue → orange — a grand soft day.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    if (tempC >= 20) {
      return {
        gradient: g("rgba(64,150,215,0.60)", "rgba(150,170,180,0.40)", "rgba(255,150,55,0.50)"),
        vibe: "Warm and wet — a grand soft day.",
      };
    }
    return {
      gradient: g("rgba(70,150,205,0.58)", "rgba(70,110,165,0.40)", "rgba(50,70,120,0.30)"),
      vibe: "Bring a brolly — it's a wet one.",
    };
  }
  // Fog — soft pewter.
  if (code === 45 || code === 48) {
    return {
      gradient: g("rgba(180,190,205,0.55)", "rgba(150,160,178,0.38)", "rgba(128,138,155,0.26)"),
      vibe: "Murky and grey out there.",
    };
  }
  // Overcast — but a hot, grey day still feels warm/muggy here.
  if (code === 3) {
    if (tempC >= 20) {
      return {
        gradient: g("rgba(240,185,105,0.55)", "rgba(190,180,165,0.38)", "rgba(140,148,160,0.28)"),
        vibe: "Warm but grey — a muggy one.",
      };
    }
    return {
      gradient: g("rgba(165,178,195,0.52)", "rgba(140,152,170,0.36)", "rgba(120,132,150,0.26)"),
      vibe: "Cloud's in for the day.",
    };
  }
  // Clear or mainly/partly clear → warmth scales with temperature.
  // Bands tuned for Northern Ireland, where 20°C+ counts as a hot day.
  if (tempC >= 25) {
    return {
      gradient: g("rgba(255,205,70,0.70)", "rgba(255,140,55,0.52)", "rgba(255,95,75,0.40)"),
      vibe: "Scorcher for here — find some shade.",
    };
  }
  if (tempC >= 20) {
    return {
      gradient: g("rgba(255,210,85,0.66)", "rgba(255,160,60,0.48)", "rgba(255,120,70,0.34)"),
      vibe: "Properly warm for NI — get the shorts out.",
    };
  }
  if (tempC >= 15) {
    return {
      gradient: g("rgba(255,222,110,0.60)", "rgba(190,215,110,0.42)", "rgba(110,200,140,0.32)"),
      vibe: "Lovely and mild — get outside.",
    };
  }
  if (tempC >= 9) {
    return {
      gradient: g("rgba(255,224,140,0.52)", "rgba(160,205,200,0.38)", "rgba(110,180,230,0.34)"),
      vibe: "Fresh and bright — grab a jacket.",
    };
  }
  if (tempC >= 3) {
    return {
      gradient: g("rgba(150,205,245,0.56)", "rgba(175,210,245,0.40)", "rgba(205,225,250,0.30)"),
      vibe: "Crisp and cold — wrap up.",
    };
  }
  return {
    gradient: g("rgba(120,195,245,0.60)", "rgba(165,210,248,0.42)", "rgba(210,232,252,0.32)"),
    vibe: "Bitterly cold — bundle up.",
  };
}
