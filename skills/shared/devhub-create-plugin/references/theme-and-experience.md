# Theme and experience

Read this for any plugin theme or UI. A company mark and an accent colour are the starting point; the result should feel designed across the surfaces the chosen delivery path supports.

## Design direction

Inspect the incumbent DevHub UI, the user's brand references and the real workflow before editing. Preserve recognisable brand assets and respect their licences. Use an available design skill when it helps, without making a private skill a requirement for other users.

Choose a clear character and apply it consistently: typography, surface depth, navigation, controls and one or two restrained signature details. For an operational tool, keep dense information scannable and make interactive states obvious. Empty, loading, error, disabled and keyboard-focus states are part of the deliverable.

Use the current `docs/reference/ui-vocabulary.md` for checkout UI. Reuse existing cards, buttons, status tones, skeletons and hooks before adding new primitives.

## Checkout theme

Use `branding/theme.css`, `branding/presets.json` and optional brand assets. Register them in the manifest's `branding` block. Keep the preset id stable and scope all component overrides to it:

```css
:root[data-theme-preset="example"] { /* shared type and shape tokens */ }
:root[data-theme="dark"][data-theme-preset="example"] { /* dark palette */ }
:root[data-theme="light"][data-theme-preset="example"] { /* light palette */ }
```

Copy the current token contract from a fully maintained core theme, then set intentional values. Include:

- All five surfaces: background, sidebar, surface, elevated and overlay.
- Border, muted border and control border.
- Main, muted and subtle text.
- Accent fill, hover, foreground, text ink, text-hover ink and translucent tint.
- Success, warning, danger and info colours with their tints.
- Chart colours, elevation shadows, type and radius tokens when the design uses them.

Missing tokens inherit from core. A blue plugin can otherwise end up with orange links, mismatched charts or unreadable metadata. Accent text and filled buttons often need different colours.

Set both `--font-sans` and `--font-display` when branded typography should cover headings. Self-host only fonts the user can distribute; reference checkout fonts under `/fonts-plugin/` and provide a practical fallback. Keep code in the existing monospace face. Match preset swatches to each mode's actual background.

Style real shell and content classes, not generated class names or fragile DOM positions. Keep content layouts, action labels and semantics intact. Do not use a moving card to imply that a static container is clickable.

Checkout presets can declare an `effects` object with `title`, `description`, `mark`, `taskMessage`, `mergeMessage` and an `effects` array. Read `apps/ui/lib/plugins/theme-effects-schema.ts` for the current contract. Use `mark: "brand"` for the plugin's declared logo, or choose a supported core mark.

Each effect needs a unique lowercase id, label, description, boolean default, group (`Atmosphere`, `Feedback`, `Pointer`, `Extras`) and `reducedMotion` policy (`static`, `off`, `unchanged`). Optional `requires` entries must reference another declared effect without its own dependencies. `master` and `motion` are host-owned ids. The host assigns storage/events, so omit `storageKey` and `event`.

Use `loader`, `interaction`, `celebrations` and `cursor` for the shared behaviours. Additional ids drive CSS through `data-theme-fx-<id>="on|off"` on the root. For example:

```css
:root[data-theme-preset="example"][data-theme-fx-rules="on"] .page-header {
  border-bottom: 3px double var(--border);
}
```

Declarations create saved controls and previews; they do not invent the CSS. Implement every promised effect and gate it on its flag. Gate animated CSS on `data-theme-fx-motion="on"` as well, so hidden tabs and the global motion switch stop it. Keep followers opt-in unless the user requests otherwise. Verify individual switches, master-off, reset, reload persistence, reduced motion, theme switching and actual completion events.

This data contract does not register arbitrary JavaScript components. Add a separate, generic extension point only when a requested behaviour cannot use the existing runtime. Packaged runtime branding does not consume checkout effect declarations.

## Runtime theme

Read the current `runtime.branding` schema. Its dark and light maps accept six-digit hex `bg`, `text`, `accent` and `border` values. Optional hashed assets are PNG/WebP for logos and WOFF2 for fonts.

Provide an intentional design for the plugin's embedded page as well as the host palette. The iframe does not inherit shell CSS. Check the live frame/asset contract before promising synced mode, fonts or interactions; provide a local/system mode treatment where no host bridge exists.

The host lets the user apply and restore runtime branding. Do not silently overwrite their saved core theme, invent unsupported manifest fields, or claim custom shell effects and desktop icons ship through runtime branding.

## Finish and verify

Theme native details too: selection, caret, scrollbars and focus. Preserve status meaning; brand colour must not make destructive and successful operations indistinguishable.

Use short, purposeful motion. Shimmer for arriving content; spin for an explicit user action. Idle healthy surfaces stay still. Respect `prefers-reduced-motion` and the host's `body[data-motion="off"]` switch where applicable. On touch devices, controls and revealed actions must remain usable without hover.

Run a bounded visual pass across desktop and mobile, dark and light, using the actual rendered implementation. Include a dense data view and forms or dialogs, with loading/empty/error states. Fix the defects together and confirm once. Check:

- Text at least 4.5:1 on every surface it uses; large text and meaningful control/chart marks at least 3:1.
- Button text on normal and hover fills; status text on its composited translucent badge backgrounds.
- Loaded fonts, wrapping, clipping, touch targets, keyboard focus and reduced-motion behaviour.
- Theme switching and a core preset still work; selectors do not leak into another theme.

Run the repo's contrast checker, but inspect its coverage: a checker that only reads core CSS does not validate a plugin palette. Add a targeted audit of the plugin's actual computed colours or parsed CSS when necessary. Save representative screenshots and report the tested origin and any fixture data used.
