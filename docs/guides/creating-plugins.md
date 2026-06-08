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
