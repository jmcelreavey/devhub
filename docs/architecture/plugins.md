# Plugin System

Plugins let a separate repo (or local directory) contribute assets — skills, agents, MCP
configs — into DevHub without living in the core repo. This keeps company-specific or
private content (e.g. `devhub-bi`) out of the shareable core while still syncing it to
your tools. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the broader template/fork strategy.

The plugin loader is a generalisation of the original `ai-tools` skill merge: instead of
one hard-coded upstream, any number of registered plugins merge alongside core, with
**core winning on name collisions**.

> Building one? See the step-by-step [Creating a Plugin](../guides/creating-plugins.md) guide.
> This page is the design/reference.

## Tiers

| Tier | Contributes | Status |
| ---- | ----------- | ------ |
| 1 — file-copy assets | `skills/`, `agents/`, `mcp/` | **implemented** |
| 2 — dashboard module | pages, API routes, libs, components | **implemented** |
| 3 — branding (whitelabel) | theme, fonts, logo, OpenChamber theme, Electron icon | **implemented** |

Docs and persona-modes are not yet plugin-aware (different delivery mechanisms).

## Tier 2 — dashboard modules

A plugin can ship a Next.js module (pages, API routes, libs, components) via a `dashboard`
manifest field:

```json
"dashboard": {
  "root": "dashboard",
  "paths": ["app/ops", "app/api/bi", "lib/bi-ops.ts", "components/CapiScriptsCard.tsx"]
}
```

The **materialiser** (`dashboard/lib/plugins/materialize.ts`, run via `sync_plugins` and
wired into `predev`/`prebuild`/`prestart`) copies each path from the plugin into the core
dashboard at the **same relative path** — so the plugin's `@/lib` / `@/components` imports
resolve unchanged and Next compiles them as if they were core files. It:

- refuses to overwrite any **git-tracked** core path (never clobbers core);
- ignores the copies via `.git/info/exclude` (machine-local, never committed — the set is
  per-machine since it depends on which plugins are registered);
- prunes paths no longer contributed.

Nav: a plugin's pages still need a sidebar entry. Today the gated entry (e.g. `/ops` with
`gate: "bi"`) lives as a stub in core `lib/nav.ts`; the `bi` gate is computed by a
dependency-free `lib/bi-presence.ts` detector so core holds no BI feature code. (Generic
plugin-contributed nav is a possible future enhancement.)

## Tier 3 — branding (whitelabel)

A plugin can **whitelabel** DevHub when it's enabled: contribute a theme palette + presets,
seed the default theme/mode, swap the UI font, the sidebar/boot logo, the OpenChamber
theme, and the Electron app icon. Nothing here is plugin-specific in core — any plugin can
do it by adding a `branding` block to its manifest:

```json
"branding": {
  "themeCss": "branding/theme.css",
  "presets": "branding/presets.json",
  "defaultPreset": "acme",
  "defaultMode": "system",
  "fonts": "branding/fonts",
  "logo": { "src": "branding/logo.svg", "label": "ACME" },
  "openchamber": { "themes": "branding/oc", "defaultDarkId": "acme-dark", "defaultLightId": "acme-light" },
  "electronIcon": "branding/icon.png"
}
```

The **branding materialiser** (`dashboard/lib/plugins/branding.ts`, run alongside the
dashboard materialiser via `sync_plugins` + `postinstall`) reads the **first enabled
plugin** that declares `branding` and writes machine-local generated files:

| Target | Source | Consumed by |
| ------ | ------ | ----------- |
| `app/plugin-branding.generated.css` | `themeCss` (verbatim) + copied fonts | imported by `app/layout.tsx` after `globals.css` |
| `lib/plugin-branding.generated.ts` | `presets`, `defaultPreset`, `defaultMode`, `logo` | `lib/theme-presets.ts`, `lib/brand-mark.ts` |
| `public/fonts-plugin/*` | `fonts` dir | `@font-face url("/fonts-plugin/…")` in your `themeCss` |
| `public/plugin-brand-logo.*` | `logo.src` | sidebar chip, mobile bar, boot screen |
| `public/plugin-electron-icon.png` | `electronIcon` | the Electron launcher (`electron-wrapper`) |
| `~/.config/openchamber/{themes,settings.json}` | `openchamber` | OpenChamber itself (only if installed) |

Key properties:

- **Seeds, never forces.** `defaultPreset` / `defaultMode` / `logo` only set the out-of-box
  default. The theme picker, the dark/light/system toggle, and the IconPicker still let the
  user override, and their choice (in `localStorage`, or OpenChamber's `settings.json`) is
  never overwritten.
- **No core clobbering.** The two generated source files are committed as *empty baselines*
  (so a fresh clone and CI build work with no plugin), and the materialiser rewrites them
  locally then `git update-index --skip-worktree` so the whitelabel never shows as repo
  churn. Copied `public/` assets are git-ignored.
- **OpenChamber is optional.** Its theme is applied only when an OpenChamber data dir
  exists on the machine; otherwise that step is skipped.
- **One brander at a time.** If several enabled plugins declare `branding`, the first wins
  and a warning is logged. Disabling the brander restores the empty baseline and prunes the
  copied assets.

See `docs/guides/creating-plugins.md` for a step-by-step branding walkthrough.

## Manifest

Each plugin repo has a `devhub-plugin.json` at its root:

```json
{
  "name": "bi",
  "version": "0.1.0",
  "devhubApi": "1",
  "navGate": "bi",
  "contributes": {
    "agents": "agents/",
    "skills": "skills/"
  }
}
```

- `name` — lowercase slug; becomes the origin tag `plugin:<name>`.
- `devhubApi` — contract version DevHub understands (currently `1`).
- `contributes` — map of asset kind → directory relative to the plugin root.
  Supported keys: `skills`, `agents`, `mcp`, `personaModes`, `docs`.
- `requires` — optional machine tooling this plugin needs (see [Requirements](#requirements)).

## Requirements

A plugin can mandate CLI tools that must be on `PATH` — without the core template forcing
them on every forker. Declare them in the manifest:

```json
"requires": {
  "commands": [
    { "command": "safe-chain", "install": "npm install -g @aikidosec/safe-chain@1.1.10" }
  ]
}
```

`dashboard/scripts/check-plugin-requirements.mjs` runs in **`preinstall`**: it reads the
machine-local registry, and for each *enabled* plugin verifies every required `command`
resolves on `PATH`. If one is missing it prints the `install` hint and fails the install.

This is how the **BI plugin requires `safe-chain`** while the public template does not — a
fresh fork with no plugins registered hits no requirements at all; the gate only bites once
you register a plugin that opts in. The check is dependency-free (it runs before
`node_modules` exists) and tolerant — a missing/broken registry or manifest is skipped,
never fatal.

Layout inside a plugin mirrors core:

```
devhub-bi/
  devhub-plugin.json
  agents/<name>.md            # flat .md files (like agents/shared)
  skills/<name>/SKILL.md      # one dir per skill
  mcp/<name>.json             # one canonical server JSON per file
```

## Registry (machine-local, never committed)

`~/.config/devhub/plugins.json` lists which plugins this machine has and whether they're
enabled (same home as the `mcp-personal/` catalog):

```json
{
  "plugins": [
    { "name": "bi", "path": "~/Developer/devhub-bi", "enabled": true }
  ]
}
```

`path` accepts `~`. Disabled entries, missing paths, name/manifest mismatches, and
invalid manifests are skipped (logged), never fatal — one bad plugin can't break sync.

## Precedence and read-only

- Order: **core → ai-tools → plugins** (registry order). First occurrence of a name wins.
- Plugin assets are **read-only** in DevHub — edit them in the plugin repo. The Skills
  and Agents APIs mark them `readOnly`, the UI hides edit/delete, mutating routes return
  403, and collect never pulls them back into `skills/shared` / `agents/shared`.
- Origin is exposed as `core` or `plugin:<name>` (see `dashboard/lib/plugins/types.ts`).

## Where it lives

| Concern | File |
| ------- | ---- |
| Types / origin | `dashboard/lib/plugins/types.ts` |
| Manifest reader (zod) | `dashboard/lib/plugins/manifest.ts` |
| Registry + asset-dir resolution | `dashboard/lib/plugins/registry.ts` |
| Agent merge | `dashboard/lib/sync-agents.ts` (`resolveAgentSources`) |
| Skill merge | `dashboard/lib/skill-catalog.ts` (`buildMergedSkillCatalog`) |
| MCP merge | `dashboard/lib/sync-mcp.ts` (`pluginMcpServers`, `readCatalogMcpServer`) |

## ai-tools

`ai-tools` remains its own merge path (`AI_TOOLS_ROOT`) today; conceptually it is "the
first plugin" and is slated to fold into this mechanism as a registered plugin. Until
then, both run side by side and core still wins over both.
