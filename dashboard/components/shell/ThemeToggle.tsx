"use client";

import { useSyncExternalStore } from "react";
import {
  getThemeSelectionFromDom,
  getServerThemeSelectionSnapshot,
  subscribeThemeSelection,
} from "@/lib/theme-presets";

/** Reactive accessor for the current theme — re-renders on system or local change. */
export function useTheme() {
  return useSyncExternalStore(
    subscribeThemeSelection,
    getThemeSelectionFromDom,
    getServerThemeSelectionSnapshot,
  );
}
