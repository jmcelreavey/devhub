"use client";

import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/shell/ThemeToggle";
import { hollowActivityPaused } from "./hollow-activity";
import { refreshHollowEffects, useHollowEffects, useHollowMotion } from "@/components/hollow/useHollowEffects";
import {
  HOLLOW_PRESET_ID,
  HOLLOW_PREVIEW_KEY,
  applyHollowDom,
  hollowRuntimePlan,
  isHollowFaceShot,
  isHollowPreview,
  HOLLOW_EFFECT_DEFAULTS,
  type HollowEffects as HollowEffectsState,
} from "@/lib/hollow-theme";

const HollowEffects = dynamic(
  () => import("@/components/hollow/HollowEffects").then((mod) => mod.HollowEffects),
  { ssr: false },
);

function subscribePreview(): () => void {
  return () => {};
}

function readPreview(): boolean {
  return isHollowPreview(window.location.search, localStorage.getItem(HOLLOW_PREVIEW_KEY));
}

function readFace(): boolean {
  return isHollowFaceShot(window.location.search);
}

/**
 * Other presets never render this chunk. Attributes are stripped as soon as
 * the preset changes so scoped CSS cannot keep painting.
 */
function ActiveHollow({ effects }: { effects: HollowEffectsState }) {
  const motion = useHollowMotion();
  const preview = useSyncExternalStore(subscribePreview, readPreview, () => false);
  const faceShot = useSyncExternalStore(subscribePreview, readFace, () => false);

  useEffect(() => {
    applyHollowDom(
      document.documentElement,
      HOLLOW_PRESET_ID,
      effects,
      preview && motion,
    );
    // Preference/motion changes run cleanup too; preserve the editing pause.
    document.documentElement.toggleAttribute("data-hollow-paused", hollowActivityPaused());
    window.addEventListener("storage", refreshHollowEffects);
    return () => {
      window.removeEventListener("storage", refreshHollowEffects);
      applyHollowDom(document.documentElement, "", effects, false);
    };
  }, [effects, preview, motion]);

  const plan = hollowRuntimePlan(effects, motion);
  if (!plan.mount) return null;
  return <HollowEffects plan={plan} preview={preview && motion} faceShot={faceShot && motion} />;
}

function SelectedHollow() {
  const effects = useHollowEffects();
  useEffect(() => {
    if (!effects.master) applyHollowDom(document.documentElement, "", effects, false);
  }, [effects]);
  return effects.master ? <ActiveHollow effects={effects} /> : null;
}

export const HOLLOW_FAVICON_ID = "hollow-favicon";
const HOLLOW_FAVICON_HREF = "/hollow/brand-mark-dark.svg";

/**
 * The tab icon follows the Halloween mark while Hollow is selected. Appended
 * last so it wins over the stock icons; removed the moment the preset changes.
 */
function useHollowFavicon(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const link = document.createElement("link");
    link.id = HOLLOW_FAVICON_ID;
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = HOLLOW_FAVICON_HREF;
    document.head.appendChild(link);
    return () => link.remove();
  }, [active]);
}

export function HollowGate() {
  const { preset } = useTheme();
  useHollowFavicon(preset === HOLLOW_PRESET_ID);
  useEffect(() => {
    if (preset !== HOLLOW_PRESET_ID) {
      applyHollowDom(document.documentElement, preset, HOLLOW_EFFECT_DEFAULTS, false);
    }
  }, [preset]);
  return preset === HOLLOW_PRESET_ID ? <SelectedHollow /> : null;
}
