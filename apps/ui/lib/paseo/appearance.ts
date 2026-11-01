"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

let background: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setPaseoBackground(value: unknown): void {
  if (typeof value !== "string" || !/^rgba?\([\d\s.,%]+\)$/.test(value) || value === background) return;
  background = value;
  for (const listener of listeners) listener();
}
export function usePaseoChrome(): CSSProperties | undefined {
  const value = useSyncExternalStore(subscribe, () => background, () => undefined);
  if (!value) return;
  const rgb = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!rgb || rgb.length !== 3) return;
  const dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 140;
  return { backgroundColor: value, color: dark ? "#f1f1f1" : "#202020",
    "--text": dark ? "#f1f1f1" : "#202020",
    "--text-muted": dark ? "#aaa" : "#626262", "--accent": dark ? "#c1d8ff" : "#255da8",
  } as CSSProperties;
}
