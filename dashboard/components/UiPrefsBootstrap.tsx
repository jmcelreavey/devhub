"use client";

import { useEffect } from "react";
import { applyUiPrefs } from "@/lib/ui-prefs";

/** Applies saved density/motion preferences to <body> on mount. */
export function UiPrefsBootstrap() {
  useEffect(() => {
    applyUiPrefs();
  }, []);
  return null;
}
