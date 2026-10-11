"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/shell/ThemeToggle";
import { applyGraphiteDom } from "@/lib/graphite-theme";
import { useGraphiteEffects, useGraphiteMotion } from "./useGraphiteEffects";

const GraphiteEffects = dynamic(() => import("./GraphiteEffects").then(mod => mod.GraphiteEffects), { ssr: false });

/** Other themes need neither preference listeners nor a motion observer. */
function ActiveGraphite() {
  const effects = useGraphiteEffects();
  const motion = useGraphiteMotion();
  useEffect(() => {
    const root = document.documentElement;
    applyGraphiteDom(root, "graphite", effects);
    root.setAttribute("data-graphite-motion", motion ? "on" : "off");
    return () => {
      applyGraphiteDom(root, "", effects);
      root.removeAttribute("data-graphite-motion");
    };
  }, [effects, motion]);

  if (!effects.master || !motion) return null;
  return effects.cursor || effects.celebrations ? <GraphiteEffects cursor={effects.cursor} celebrations={effects.celebrations} /> : null;
}

export function GraphiteGate() {
  const { preset } = useTheme();
  return preset === "graphite" ? <ActiveGraphite /> : null;
}
