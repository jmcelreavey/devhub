"use client";

import { lazy, Suspense, useEffect } from "react";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useTheme } from "@/components/shell/ThemeToggle";
import { useGraphiteMotion } from "@/components/graphite/useGraphiteEffects";
import { applyThemeEffectsDom, canMountPluginThemeEffects, effectEnabled } from "@/lib/theme-effects";
import { resetThemeLifecycleFailure, useThemeEffects, useThemeLifecycleFailed } from "./useThemeEffects";
import { getRuntimeThemes } from "@/lib/plugins/runtime-theme-client";
import { RuntimeThemeHost } from "./RuntimeThemeHost";
import { useRuntimeThemes } from "./RuntimeThemes";

const Effects = lazy(() => import("@/components/graphite/GraphiteEffects").then((module) => ({ default: module.GraphiteEffects })));
export function hasPluginThemeLifecycle(preset: string): boolean {
  return getRuntimeThemes().some(theme => theme.id === preset && theme.effects);
}

export function ThemeEffectsGate() {
  const mounted = useClientMounted();
  const { preset } = useTheme();
  const runtime = useRuntimeThemes().find(theme => theme.id === preset);
  const preferences = useThemeEffects(preset);
  const motion = useGraphiteMotion();
  const lifecycleFailed = useThemeLifecycleFailed(preset);
  useEffect(() => {
    applyThemeEffectsDom(document.documentElement, preset, preferences, motion);
    return () => applyThemeEffectsDom(document.documentElement, "", preferences, false);
  }, [preset, preferences, motion]);
  useEffect(() => () => resetThemeLifecycleFailure(preset), [preset, runtime?.revision]);
  const animated = canMountPluginThemeEffects(preset, preferences.master, motion);
  const cursor = (!runtime || runtime.hostEffects?.includes("cursor") === true) && animated && preset !== "hollow" && effectEnabled(preset, preferences, "cursor", motion);
  const celebrations = (!runtime || runtime.hostEffects?.includes("celebrations") === true) && animated && effectEnabled(preset, preferences, "celebrations", motion);
  return <>
    {runtime && !lifecycleFailed && <RuntimeThemeHost key={`${runtime.revision}:${preset}`} theme={runtime} />}
    {mounted && (cursor || celebrations) && <Suspense fallback={null}><Effects preset={preset} cursor={cursor} celebrations={celebrations} /></Suspense>}
  </>;
}
