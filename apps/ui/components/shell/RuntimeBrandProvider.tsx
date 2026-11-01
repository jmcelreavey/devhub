"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setDesktopBrandLogo } from "@/lib/desktop/app-icon";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";

interface Brand {
  name: string;
  label: string;
  dark: Record<string, string>;
  light: Record<string, string>;
  logo: string | null;
  font: string | null;
}
const Context = createContext<{ brand: Brand | null; selected: string; select: (name: string) => void }>({ brand: null, selected: "", select: () => {} });
const KEY = "devhub:runtime-brand";
export const useRuntimeBrand = () => useContext(Context);

export function RuntimeBrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/plugins/runtime-branding", { signal: controller.signal });
        if (!response.ok) { setBrands([]); return; }
        const result = await response.json();
        if (!controller.signal.aborted) { setBrands(result); setSelected(localStorage.getItem(KEY) ?? ""); }
      } catch { if (!controller.signal.aborted) setBrands([]); }
    };
    void refresh();
    const unsubscribe = subscribeToTaskEvents({ plugins: true, domains: ["plugins"], connection: () => {}, refresh: () => { void refresh(); } });
    return () => { controller.abort(); unsubscribe(); };
  }, []);
  const brand = brands.find((item) => item.name === selected) ?? null;
  useEffect(() => { setDesktopBrandLogo(brand?.logo ?? null); }, [brand]);
  const css = brand ? (["dark", "light"] as const).map((mode) => `:root[data-theme="${mode}"]{${Object.entries(brand[mode]).map(([key, value]) => `--${key}:${value}`).join(";")}}`).join("\n") +
    (brand.font ? `@font-face{font-family:RuntimePlugin;src:url("${brand.font}")}body{font-family:RuntimePlugin, sans-serif}` : "") : "";
  return <Context.Provider value={{ brand, selected, select: (name) => { localStorage.setItem(KEY, name); setSelected(name); } }}>
    {css ? <style>{css}</style> : null}
    {children}
  </Context.Provider>;
}
