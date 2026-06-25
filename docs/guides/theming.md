# Theming

DevHub supports visual themes and accent choices so the dashboard feels comfortable for daily use.

## Theme Controls

Theme controls are available in the dashboard UI.

Depending on the current build, you may see options for:

- Light or dark mode.
- Accent colors.
- Preset theme styles.
- Seasonal marks or icons.

## OpenChamber Themes

DevHub ships matching OpenChamber themes in `dashboard/config/openchamber-themes/`. On `npm install` (via `scripts/postinstall.ts`) it:

- copies those theme files into OpenChamber's themes dir (`~/.config/openchamber/themes`, or `OPENCHAMBER_DATA_DIR/themes`), and
- seeds the default selection (`darkThemeId` / `lightThemeId` / `themeVariant`) into OpenChamber's `settings.json` — **only** for keys you haven't already set, so your own theme choice is never overwritten.

Because this lives in OpenChamber's own config directory rather than a patched copy of the app, it works with any developer-managed OpenChamber install and survives upgrades.

## Customization Guidance

- Prefer theme variables over one-off hardcoded colors.
- Keep contrast high enough for daily work.
- Test mobile and desktop views.
- Avoid making core status colors ambiguous.

## Contributor Notes

When adding UI, use existing visual patterns before introducing a new one. If a new visual pattern is needed, make it reusable.
