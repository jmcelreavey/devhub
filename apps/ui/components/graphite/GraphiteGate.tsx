"use client";

import { lazy, Suspense, useEffect } from "react";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { useTheme } from "@/components/shell/ThemeToggle";
import { applyGraphiteDom } from "@/lib/graphite-theme";
import { useGraphiteEffects, useGraphiteMotion } from "./useGraphiteEffects";

const GraphiteEffects = lazy(() => import("./GraphiteEffects").then((module) => ({ default: module.GraphiteEffects })));

/** Other themes need neither preference listeners nor a motion observer. */
function ActiveGraphite() {
  const effects = useGraphiteEffects();
  const motion = useGraphiteMotion();
  const mounted = useClientMounted();
  useEffect(() => {
    const root = document.documentElement;
    applyGraphiteDom(root, "graphite", effects);
    root.setAttribute("data-graphite-motion", motion ? "on" : "off");
    return () => {
      applyGraphiteDom(root, "", effects);
      root.removeAttribute("data-graphite-motion");
    };
  }, [effects, motion]);

  if (!mounted || !effects.master || !motion) return null;
  return effects.cursor || effects.celebrations ? <Suspense fallback={null}><GraphiteEffects cursor={effects.cursor} celebrations={effects.celebrations} /></Suspense> : null;
}

export function GraphiteGate() {
  const { preset } = useTheme();
  return preset === "graphite" ? <ActiveGraphite /> : null;
}
