import { HAS_PLUGIN_BRAND } from "@/lib/brand-mark";
import { isDesktop, setDesktopIcon } from "./bridge";
import { getThemeSelectionFromDom, subscribeThemeSelection } from "@/lib/theme-presets";

/** Matches IconPicker storage sentinels. */
const DEVHUB_VALUE = "__devhub__";
const BOTTLE_VALUE = "__bottle__";

export type DesktopIconKind = "default" | "plugin" | "halloween";

/**
 * Which OS icon the current in-app logo corresponds to.
 *
 * Hollow temporarily overrides every brand. Otherwise decorative picks keep
 * the last brand, and `__devhub__` restores the bundled mark even with a plugin.
 */
export function desktopIconKind(
  stored: string,
  hasPluginBrand: boolean = HAS_PLUGIN_BRAND,
  preset: string = "graphite",
): DesktopIconKind | null {
  if (preset === "hollow") return "halloween";
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

let syncVersion = 0;
let baseKind: DesktopIconKind = "default";

/** Sync the bootstrapped theme on mount and follow manual, seasonal and cross-tab changes. */
export function subscribeDesktopAppIcon(stored: string): () => void {
  const sync = () => { void syncDesktopAppIcon(stored); };
  sync();
  return subscribeThemeSelection(sync);
}

/** No-op in a browser tab. Failures are cosmetic — never break the picker. */
export async function syncDesktopAppIcon(stored: string): Promise<void> {
  if (typeof window === "undefined" || !isDesktop()) return;
  const version = ++syncVersion;
  baseKind = desktopIconKind(stored) ?? baseKind;
  const kind = desktopIconKind(stored, HAS_PLUGIN_BRAND, getThemeSelectionFromDom().preset) ?? baseKind;
  if (kind === "plugin") {
    const png = await fetchPng("/plugin-desktop-icon.png");
    if (version !== syncVersion) return;
    if (!png) {
      await setDesktopIcon("default");
      return;
    }
    await setDesktopIcon("plugin", png);
    return;
  }
  await setDesktopIcon(kind);
}
