---
title: Theming
description: Theme modes and presets, the seasonal Hollow theme, plugin whitelabelling, and how the palette is applied on first paint.
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

Everything lives in one place: the **Appearance** button (the palette icon) in the dashboard top bar.

| Control | Behavior |
| ------- | -------- |
| Mode | **System**, **Light** or **Dark**. System follows the OS colour scheme. |
| Theme | One of the core themes below, or one an enabled plugin adds. Each swatch previews the theme's dark and light colours. |

The core themes are **Ember Dusk** (warm charcoal and amber), **Abyss** (deep navy and electric azure), **Graphite Neon** (charcoal and lime, the default), **Tokyo Night** (purple-black and violet), **Catppuccin** (Mocha and Latte with mauve), and **Hollow**, the seasonal one ([below](#hollow-the-october-theme)).

Your choice is stored in `localStorage` (`devhub:theme` for the mode, `devhub:theme-preset` for the theme) and applied on first paint via an inline bootstrap script in `app/layout.tsx` to avoid a flash of the wrong palette.

### System mode

When Mode is **System**, DevHub resolves light or dark from `prefers-color-scheme` and keeps `data-theme-mode="system"`. `ThemeSystemSync` listens for OS changes and re-applies the palette without overwriting the saved setting.

When you pin **Dark** or **Light**, the resolved palette stays fixed until you pick System again.

## Hollow, the October theme

Hollow is an optional horror-flavoured theme: bruised near-black with dried-blood red, and stained paper for its light mode. It switches itself on once a year, in October (`lib/hollow-theme.ts`):

- **The first time you open DevHub in October**, Hollow is applied before the first paint. DevHub remembers the theme you had.
- **If you pick another theme during October**, that choice sticks for the rest of the month.
- **When October ends**, DevHub puts your previous theme back, unless you chose a different one yourself. Your mode (System, Light or Dark) is left alone.

The bookkeeping is in `localStorage` (`devhub:hollow-season`), so it belongs to one browser (or the desktop app) at one address. Open DevHub from a different browser or port and that counts as a first open.

To switch Hollow off, open **Appearance** and pick any other theme. While Hollow is selected, the same menu has a **Hollow** section with a switch for each effect:

| Switch | What it does | Default |
| ------ | ------------ | ------- |
| Effects | Master switch. Off keeps the Hollow colours and drops every effect below. | On |
| Atmosphere | Layered fog, guttering light, grain and bottle wisps. | On |
| Creatures | Watching eyes, spiders and a shadow passing through the fog. | On |
| Rare events | A passing presence every few minutes. Needs Atmosphere, Creatures and motion. | On |
| Interaction | Spectral trails, cobweb sway, cracks and heading glitch. | On |
| Jump scares | Off unless you ask. Type `boo` outside a text field. | Off |
| Sound | A low drone. Starts on the click that turns it on and stops when the tab hides. | Off |

Reduced motion keeps the static textures (grain, vignette, stains) and turns off flicker, drifting, creatures, glitch, the cursor trail and jump scares. The **Toggle animations** action in the command palette turns motion off everywhere, Hollow included (see [Motion](../contributing/motion.md)).

## Plugin whitelabel (tier 3)

An enabled plugin can contribute branding: custom presets, default mode, fonts, logo, and a desktop app icon. The branding materialiser writes generated files locally (`plugin-branding.generated.*`) that `theme-presets.ts` and the layout consume. That happens when a checkout materialises the plugin, not inside an already built app. The Plugins page can review a branding declaration, but it will not enable or apply it.

- Plugin presets appear in the same Appearance menu as core themes.
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
