"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/shell/ThemeToggle";
import { useGraphiteMotion } from "@/components/graphite/useGraphiteEffects";
import { applyThemeEffectsDom, effectEnabled } from "@/lib/theme-effects";
import { useThemeEffects } from "./useThemeEffects";

const Effects = dynamic(() => import("@/components/graphite/GraphiteEffects").then(module => module.GraphiteEffects), { ssr: false });

export function ThemeEffectsGate() {
  const { preset } = useTheme();
  const preferences = useThemeEffects(preset);
  const motion = useGraphiteMotion();
  useEffect(() => {
    applyThemeEffectsDom(document.documentElement, preset, preferences, motion);
    return () => applyThemeEffectsDom(document.documentElement, "", preferences, false);
  }, [preset, preferences, motion]);
  if (preset === "graphite" || !preferences.master || !motion) return null;
  const cursor = preset !== "hollow" && effectEnabled(preset, preferences, "cursor", motion);
  const celebrations = effectEnabled(preset, preferences, "celebrations", motion);
  return cursor || celebrations ? <Effects preset={preset} cursor={cursor} celebrations={celebrations} /> : null;
}
