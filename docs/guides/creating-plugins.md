# Creating a Plugin

A plugin is a **separate repo** that adds skills, agents, MCP servers, and/or a dashboard
module to DevHub without living in the core repo. This guide walks through building one
from scratch. For the design/reference, see [Plugins](../architecture/plugins.md).

> Core always wins on name collisions, and plugin assets are **read-only** inside DevHub —
> you edit them in the plugin repo, then re-sync.

## 1. Scaffold the repo

```bash
mkdir -p ~/dev/devhub-myplugin && cd ~/dev/devhub-myplugin
git init
```

Add a manifest at the root, `devhub-plugin.json`:

```json
{
  "name": "myplugin",
  "version": "0.1.0",
  "devhubApi": "1",
  "contributes": {}
}
```

- `name` — lowercase slug (`[a-z0-9][a-z0-9_-]*`). Becomes the origin tag `plugin:myplugin`.
- `devhubApi` — the contract version DevHub understands (currently `"1"`).
- `contributes` / `dashboard` — filled in below.

## 2. Add tier-1 assets (skills, agents, MCP)

These are file-copy assets — the simplest contribution. Lay them out like core:

```
devhub-myplugin/
  devhub-plugin.json
  skills/<skill-name>/SKILL.md      # one dir per skill
  agents/<agent-name>.md            # one flat .md per agent
  mcp/<server-name>.json            # one canonical server JSON per file
  mcp-servers/<server-name>/         # optional stdio server package
```

Declare the directories in `contributes`:

```json
"contributes": {
  "skills": "skills/",
  "agents": "agents/",
  "mcp": "mcp/"
}
```

That's it — at sync time these merge into DevHub's catalogs alongside core and ai-tools.

For MCP, `mcp/<server-name>.json` is the catalog entry that gets synced into Claude,
Cursor, Codex, OpenCode, and other configured clients. If the plugin only points at
an existing command, the JSON file is enough. If it ships its own stdio server, put
that Node package under `mcp-servers/<server-name>/` with its own `package.json`;
DevHub's bootstrap and health check install missing dependencies for enabled plugin
server packages.

Use the `PLUGIN_ROOT` placeholder when the MCP command or args need to point back to
the plugin checkout:

```json
{
  "command": "PLUGIN_ROOT/mcp-servers/myplugin-server/node_modules/.bin/tsx",
  "args": ["PLUGIN_ROOT/mcp-servers/myplugin-server/src/server.ts"]
}
```

`PLUGIN_ROOT` is replaced with the registered plugin path during MCP sync. Use
`REPO_ROOT` only for files in the DevHub core checkout.

## 3. Register the plugin locally

Plugins are listed in a **machine-local** file (never committed), `~/.config/devhub/plugins.json`:

```json
{
  "plugins": [
    { "name": "myplugin", "path": "~/dev/devhub-myplugin", "enabled": true }
  ]
}
```

`path` accepts `~`. Set `"enabled": false` to disable without removing.

## 4. Sync and verify

From the DevHub dashboard: **Skills / Actions → Sync**. Or from the CLI:

```bash
cd ~/dev/devhub/dashboard
npx tsx scripts/run-action.ts sync
```

Your skills/agents/MCP now appear in the catalog tagged `plugin:myplugin` (read-only), and
sync to your tools (Claude, Codex, Cursor, OpenCode). The Skills page shows a per-plugin
badge.

## 5. (Optional) Add a tier-2 dashboard module

A plugin can ship Next.js pages, API routes, libs, and components. Mirror the core
`dashboard/` layout inside the plugin:

```
devhub-myplugin/
  dashboard/
    app/myfeature/page.tsx
    app/api/myfeature/route.ts
    lib/myfeature.ts
    components/MyCard.tsx
```

Declare them with a `dashboard` block (paths are relative to `dashboard/`):

```json
"dashboard": {
  "root": "dashboard",
  "paths": ["app/myfeature", "app/api/myfeature", "lib/myfeature.ts", "components/MyCard.tsx"]
}
```

On sync (or `predev`/`prebuild`), the **materialiser** copies these into the core dashboard
at the *same relative paths*, so your `@/lib/...` / `@/components/...` imports resolve
unchanged and Next compiles them. The copies are git-ignored via `.git/info/exclude`.

Materialise manually with:

```bash
cd ~/dev/devhub/dashboard && npx tsx scripts/run-action.ts sync_plugins
```

Rules to know:

- The materialiser **refuses to overwrite a git-tracked core path** — pick paths core
  doesn't already own. (If you're extracting from core, `git rm` them from core first.)
- A page needs a sidebar entry. Today nav entries are gated stubs in core `lib/nav.ts`
  (generic plugin-contributed nav is a future enhancement) — add one there, or gate your
  page behind an existing nav gate.

## 5a. (Optional) Overlay a core stub (single file)

When core already imports a component but the real implementation is plugin-specific,
declare an **overlay** instead of a `paths` copy. Core keeps a committed no-op baseline
(builds without your plugin); your plugin overwrites it locally.

In core, commit a stub first (example: `dashboard/app/repos/RepoRadarSection.tsx` returns
`null`). In the plugin manifest:

```json
"dashboard": {
  "root": "dashboard",
  "overlays": ["app/repos/RepoRadarSection.tsx"]
}
```

Ship the real file at `dashboard/app/repos/RepoRadarSection.tsx` inside the plugin repo.
On materialise, DevHub copies your file over the stub and marks the path
`skip-worktree` so it never shows as local churn. Overlays must be **single files** —
directories belong in `paths`.

When you remove or disable the overlay, DevHub restores the committed baseline. See
[Plugins › Overlays](../architecture/plugins.md#overlays-single-file-extensions).

## 5b. (Optional) Require machine tooling

If your plugin needs a CLI tool present (e.g. a security guard, a cloud CLI), declare it so
DevHub's `preinstall` enforces it — but only on machines that have *registered* your plugin,
never on a bare fork of the template:

```json
"requires": {
  "commands": [
    { "command": "safe-chain", "install": "npm install -g @aikidosec/safe-chain@1.1.10" }
  ]
}
```

If the `command` isn't on `PATH`, `npm install` fails with your `install` hint. See
[plugins.md › Requirements](../architecture/plugins.md#requirements).

## 5c. (Optional) Whitelabel DevHub (tier-3 branding)

Ship a theme, font, logo, OpenChamber theme and Electron icon that switch on when your
plugin is enabled. Lay the assets out under `branding/` in your plugin root:

```
my-plugin/
  branding/
    theme.css          # :root[data-theme="dark|light"][data-theme-preset="<id>"] { … }
    presets.json       # [{ "id": "<id>", "label", "description", "darkSwatch", "lightSwatch" }]
    fonts/             # *.woff2/*.woff — reference as url("/fonts-plugin/<file>") in theme.css
    logo.svg           # square brand mark (sidebar chip / boot screen)
    oc/                # OpenChamber theme JSONs (metadata.id + metadata.variant)
    icon.png           # >=512px Electron app icon
```

Then declare a `branding` block in `devhub-plugin.json`:

```json
"branding": {
  "themeCss": "branding/theme.css",
  "presets": "branding/presets.json",
  "defaultPreset": "<id>",
  "defaultMode": "system",
  "fonts": "branding/fonts",
  "logo": { "src": "branding/logo.svg", "label": "ACME" },
  "openchamber": { "themes": "branding/oc", "defaultDarkId": "<id>-dark", "defaultLightId": "<id>-light" },
  "electronIcon": "branding/icon.png"
}
```

Every field is optional — contribute only a palette, or only a logo, if that's all you
need. Your `theme.css` must define the palette variables for **both** `data-theme="dark"`
and `data-theme="light"` under your `data-theme-preset` id (copy the variable list from any
core block in `dashboard/app/globals.css`). Run `sync_plugins` (or just `npm run dev`) and
the new preset, default, logo and OpenChamber theme appear. Everything is a *seed*: the
theme picker, the dark/light/system toggle and the IconPicker still override it, and the
user's saved choice is never clobbered. Disable the plugin and DevHub reverts to stock.

See [plugins.md › Tier 3 — branding](../architecture/plugins.md#tier-3--branding-whitelabel)
for how the generated files are wired in.

## 6. Publish

```bash
gh repo create <you>/devhub-myplugin --private --source=. --remote=origin --push   # or --public
```

Private for company/internal plugins; public for community ones. Other developers clone
it next to their DevHub and add it to *their* `plugins.json`.

## Checklist

- [ ] `devhub-plugin.json` validates (run `npx tsx scripts/run-action.ts sync_plugins` —
      a bad manifest is reported, not fatal).
- [ ] Asset layout mirrors core (`skills/<n>/SKILL.md`, `agents/<n>.md`, `mcp/<n>.json`).
- [ ] No secrets committed; no content you wouldn't want in that repo's visibility.
- [ ] Registered in `~/.config/devhub/plugins.json` and appears in the Skills catalog.
- [ ] (tier-2) `npm run build` succeeds with the plugin registered.

See `devhub-bi` for a complete real-world example (tier-1 agents/skills **and** a tier-2
`/ops` dashboard module).
