---
title: Theming
description: Theme modes, accent presets, plugin whitelabelling, and how the palette is applied on first paint.
order: 20
icon: Palette
tags: [ui]
related:
  - contributing/motion
  - architecture/plugins
---

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

An enabled plugin can contribute branding: custom presets, default mode, fonts, logo, and a desktop app icon. The branding materialiser writes generated files locally (`plugin-branding.generated.*`) that `theme-presets.ts` and the layout consume.

- Plugin presets appear in the same accent picker as core presets.
- `defaultMode` can seed **system**, **dark**, or **light** for fresh installs; user overrides still win.
- Logo and fonts replace the sidebar chip and UI typeface when configured.

See [Plugins › Tier 3 — branding](../architecture/plugins.md#tier-3--branding-whitelabel) and [Creating a Plugin › Whitelabel](../contributing/creating-plugins.md#5c-optional-whitelabel-devhub-tier-3-branding) for the manifest layout.

## Customization Guidance

- Prefer theme variables over one-off hardcoded colors.
- Keep contrast high enough for daily work.
- Test mobile and desktop views.
- Avoid making core status colors ambiguous.

## Contributor Notes

When adding UI, use existing visual patterns before introducing a new one. If a new visual pattern is needed, make it reusable.
