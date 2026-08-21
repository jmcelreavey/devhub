import { HAS_PLUGIN_BRAND } from "@/lib/brand-mark";
import { isDesktop, setDesktopIcon } from "./bridge";

/** Matches IconPicker storage sentinels. */
const DEVHUB_VALUE = "__devhub__";
const BOTTLE_VALUE = "__bottle__";

export type DesktopIconKind = "default" | "plugin";

/**
 * Which OS icon the current in-app logo corresponds to.
 *
 * Lucide / seasonal picks are chrome, not a brand — leave the Dock alone.
 * `__devhub__` must always return `"default"`, even when a plugin brand is
 * installed. That is the whole bug: the picker switched, the Dock did not.
 */
export function desktopIconKind(
  stored: string,
  hasPluginBrand: boolean = HAS_PLUGIN_BRAND,
): DesktopIconKind | null {
  if (stored === DEVHUB_VALUE) return "default";
  if (stored === BOTTLE_VALUE || stored === "") {
    return hasPluginBrand ? "plugin" : "default";
  }
  return null;
}

async function fetchPng(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return buf;
  } catch {
    return null;
  }
}

/** No-op in a browser tab. Failures are cosmetic — never break the picker. */
export async function syncDesktopAppIcon(stored: string): Promise<void> {
  if (typeof window === "undefined" || !isDesktop()) return;
  const kind = desktopIconKind(stored);
  if (!kind) return;
  if (kind === "plugin") {
    const png = await fetchPng("/plugin-desktop-icon.png");
    if (!png) {
      await setDesktopIcon("default");
      return;
    }
    await setDesktopIcon("plugin", png);
    return;
  }
  await setDesktopIcon("default");
}
