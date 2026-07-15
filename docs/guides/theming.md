# Theming

DevHub supports visual themes and accent choices so the dashboard feels comfortable for daily use.

## Theme Controls

Theme controls live in the dashboard top bar:

| Control | Behavior |
| ------- | -------- |
| Theme toggle (Monitor / Moon / Sun) | Cycles **system → dark → light → system**. The Monitor icon means the palette follows the OS colour scheme. |
| Accent / preset picker | Chooses a colour preset (`data-theme-preset`). Presets come from core defaults or from an enabled plugin's branding. |

Your choice is stored in `localStorage` (`devhub-theme-mode`, `devhub-theme-preset`) and applied on first paint via an inline bootstrap script in `app/layout.tsx` to avoid a flash of the wrong palette.

### System mode

When the toggle is on **system**, DevHub resolves light or dark from `prefers-color-scheme` and keeps `data-theme-mode="system"`. `ThemeSystemSync` listens for OS changes and re-applies the palette without overwriting the user's pinned setting.

When you pin **dark** or **light**, the resolved palette stays fixed until you cycle back to system.

## Plugin whitelabel (tier 3)

An enabled plugin can contribute branding: custom presets, default mode, fonts, logo, OpenChamber themes, and an Electron icon. The branding materialiser writes generated files locally (`plugin-branding.generated.*`) that `theme-presets.ts` and the layout consume.

- Plugin presets appear in the same accent picker as core presets.
- `defaultMode` can seed **system**, **dark**, or **light** for fresh installs; user overrides still win.
- Logo and fonts replace the sidebar chip and UI typeface when configured.

See [Plugins › Tier 3 — branding](../architecture/plugins.md#tier-3--branding-whitelabel) and [Creating a Plugin › Whitelabel](creating-plugins.md#5c-optional-whitelabel-devhub-tier-3-branding) for the manifest layout.

## OpenChamber Themes

DevHub ships matching OpenChamber themes in `dashboard/config/openchamber-themes/`. On `npm install` (via `scripts/postinstall.ts`) it:

- copies those theme files into OpenChamber's themes dir (`~/.config/openchamber/themes`, or `OPENCHAMBER_DATA_DIR/themes`), and
- seeds the default selection (`darkThemeId` / `lightThemeId` / `themeVariant`) into OpenChamber's `settings.json` — **only** for keys you haven't already set, so your own theme choice is never overwritten.

When a plugin declares an `openchamber` block in its branding manifest, the materialiser also copies plugin themes and seeds OpenChamber defaults from the plugin config (same non-destructive rules — existing user choices are not overwritten).

Because this lives in OpenChamber's own config directory rather than a patched copy of the app, it works with any developer-managed OpenChamber install and survives upgrades.

## Customization Guidance

- Prefer theme variables over one-off hardcoded colors.
- Keep contrast high enough for daily work.
- Test mobile and desktop views.
- Avoid making core status colors ambiguous.

## Contributor Notes

When adding UI, use existing visual patterns before introducing a new one. If a new visual pattern is needed, make it reusable.
