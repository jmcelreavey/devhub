---
title: Creating a plugin
description: "Build a plugin repo from scratch: manifest, assets, runtime features, and registration."
order: 3
icon: PackagePlus
tags: [plugins]
related:
  - architecture/plugins
  - contributing/fork-workflow
---

# Creating a Plugin

A plugin is a **separate repo** that adds skills, agents, MCP servers, and/or a dashboard
module to DevHub without living in the core repo. This guide walks through building one
from scratch. For the design/reference, see [Plugins](../architecture/plugins.md).

The DevHub core is AGPL-3.0-only. A plugin repo has its own licence; this guide
does not pick one. Code you contribute *to the core* is AGPL-3.0-only. See the
[FAQ](../getting-started/faq.md#what-licence-is-devhub-under).

> Core always wins on name collisions, and plugin assets are **read-only** inside DevHub —
> you edit them in the plugin repo, then re-sync.

## 1. Scaffold the repo

For installation in a packaged app without rebuilding, start with [`templates/runtime-plugin`](../../templates/runtime-plugin/README.md). It contains a page, API route and stateless MCP server. The asset sync instructions below also apply to local plugins.

The runtime manifest declares `api`, `transport`, `entry`, `sha256`, `lockfile: { path, sha256 }`, `pages`, `routes`, `mcp` and `permissions: { env, network, exec }`. All file paths are relative, cannot traverse directories and cannot use symlinks. Bundle dependencies ahead of time and commit the prebuilt entry and npm lockfile. Runtime code cannot import packages from DevHub. Required commands are checked but never installed from manifest hints.

Values forwarded through `permissions.env` are treated as secrets and redacted from public provider responses. Use optional `permissions.publicEnv` only for reviewed settings that may appear in output, such as an AWS profile name or service domain. The review lists those names separately. Common credential names, runtime controls, duplicates and names also present in `env` are rejected. Changing either list requires fresh consent; never place credentials in `publicEnv`.

The host resolves reviewed names from current saved settings before its process environment, so Setup changes apply without a worker restart. Injected test contexts use only their supplied environment. Plugins receive the reviewed values, never the host settings file or unreviewed names.

Use stdin/stdout JSON as shown in the example. Do not import core modules. Return HTML for pages, JSON for APIs and JSON-RPC for MCP requests. Each request has a fresh process and must finish within 30 seconds. Background work, SSE and WebSockets need a future server transport. The `dashboard` field is no longer supported; use runtime declarations for UI features.

Page requests include `body.query` with URL query parameters as strings. `page` is reserved for the host and omitted; repeated keys use their first value. The host rejects queries longer than 4096 characters. Treat these values as untrusted and escape them before inserting them into HTML.

Optional runtime branding contains a label, `dark` and `light` maps with six-digit hex values for `bg`, `text`, `accent` and `border`, and hashed `logo`/`font` assets. Logos must be PNG or WebP; fonts must be WOFF2. Test colour contrast in both modes. Users choose the preset on the plugin page and can restore the default.

Every bundle change needs a fresh review. Permission widening, changed hashes and route changes invalidate the accepted snapshot. The current update flow is remove and reinstall; existing data is kept. Publish only code the user can reasonably trust with their account. The preview describes declared access, not a complete OS sandbox.

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
- `contributes` / `runtime` — filled in below.


You can also generate the starter tree:

```bash
npm run plugins -- new team-tools --out ~/dev/team-tools
```

That writes the runtime page and pinned lockfile, a skill, an agent, an inert MCP example under
`examples/mcp/`, and a README. It does not initialise git, register the plugin,
or publish it. It refuses a destination that already exists. Add `--dry-run` to
print the file list without writing. Runtime themes use the data contract above.

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

### Use the built-in MCP host (checkout plugins)

An enabled, local checkout plugin can also add tools to DevHub's own MCP server.
Put `devhub-mcp-toolsets.json` beside its valid `devhub-plugin.json`:

```json
{
  "version": 1,
  "toolsets": [{
    "name": "myplugin",
    "module": "src/mcp-tools.mjs",
    "export": "register",
    "tools": ["myplugin_read"]
  }]
}
```

`name` is a unique selectable group. Set `"extends": "tasks"` to register
alongside an existing core group instead; the extension's own name is then
not selectable. `DEVHUB_MCP_TOOLSETS=myplugin` selects this group,
`DEVHUB_MCP_TOOLSETS=tasks` selects a tasks extension, and `off` imports
no plugin entry modules. Unset or `all` selects every group. The descriptor
lists each entry module's tool names up front; names cannot collide with
core or other plugins. Paths are relative to the plugin root and cannot use
symlinks or escape it. List local source imports in the optional `dependencies` array.

The named export must register synchronously with
`register(server, context, api)`. The frozen `server` facade exposes only
`registerTool`; `api` supplies `z`, `blocksToText`, `textToBlocks` and
`withDashboardErrors`. Register every declared tool exactly once, with no
extras. For example:

```js
export function register(server) {
  server.registerTool("myplugin_read", { description: "Read plugin data" },
    async () => ({ content: [{ type: "text", text: "ready" }] }));
}
```

This is trusted executable code in the MCP process, with the user's access,
not a sandbox. Only explicitly enabled, unmanaged local plugins load. Disabling
a plugin blocks later calls in existing sessions; a running handler or import
side effect cannot be undone. Restart the MCP peer after source or descriptor
changes, a failed import, or re-enabling a changed plugin. The host fingerprints
the manifest, descriptor, entry module and declared dependencies; it does not
attest transitive imports, assets, environment values or all plugin source.
This checkout host contract does not establish packaged-app parity.

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

From the DevHub repo root, register the cloned plugin:

```bash
npm run plugins -- add ~/dev/devhub-myplugin
npm run plugins -- list
```

The command validates the manifest, saves the path and enables the plugin. Relative
paths refer to the directory you ran the command from. Repeating `add` updates the
existing entry instead of duplicating it.

The registry is **machine-local** and never committed: `~/.config/devhub/plugins.json`:

```json
{
  "plugins": [
    { "name": "myplugin", "path": "~/dev/devhub-myplugin", "enabled": true }
  ]
}
```

`path` accepts `~`. Use `npm run plugins -- disable myplugin` or
`npm run plugins -- enable myplugin` to change it without removing the entry.
The CLI preserves other entries and settings; malformed registry JSON must be fixed
before it will write.


To add a repository from GitHub instead of a local folder, open **Plugins** and
choose **Add from GitHub**, or run:

```bash
npm run plugins -- add-from-url https://github.com/acme/team-tools
```

`add-from-url` reviews the default branch and does not enable the plugin. The
Plugins page is also linked from Setup and from an empty Skills or Agents catalog.
The installer enables skills and agents as before. With a valid runtime bundle it
also enables the explicitly declared runtime pages, APIs, MCP endpoints and branding.
Source-only MCP servers and legacy branding still block activation; `dashboard` manifests are rejected.

## 4. Sync and verify

After adding or enabling a plugin, use
**Skills / Actions → Sync** to publish its skills, agents and MCP definitions to your
AI tools. Or run the sync from the CLI:

```bash
cd ~/dev/devhub/apps/ui
npx tsx scripts/run-action.ts sync
```

Your skills/agents/MCP now appear in the catalog tagged `plugin:myplugin` (read-only), and
sync to your tools (Claude, Codex, Cursor, OpenCode). The Skills page shows a per-plugin
badge.

## 5. Add runtime dashboard features

Use the [runtime plugin contract](../architecture/plugins.md#packaged-runtime-plugins)
for pages, APIs, providers and branding. Dashboard source copies and overlays are
not loaded by the core/Vite build.

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

## 5c. (Optional) Add branding and themes

Declare reviewed branding and theme assets in the runtime manifest. See
[reviewed runtime theme assets](../architecture/plugins.md#reviewed-runtime-theme-assets).

## 6. Publish

```bash
gh repo create <you>/devhub-myplugin --private --source=. --remote=origin --push   # or --public
```

Private for company/internal plugins; public for community ones. Other developers clone
it next to their DevHub and add it to *their* `plugins.json`.

## Checklist

- [ ] `devhub-plugin.json` validates in Plugins.
- [ ] Asset layout mirrors core (`skills/<n>/SKILL.md`, `agents/<n>.md`, `mcp/<n>.json`).
- [ ] No secrets committed; no content you wouldn't want in that repo's visibility.
- [ ] Registered in `~/.config/devhub/plugins.json` and appears in the Skills catalog.
- [ ] (tier-2) `npm run build` succeeds with the plugin registered.

Start with the [portable example plugin](../../templates/runtime-plugin/README.md). For reviewed actions and streaming, follow [Plugin actions](../guides/plugin-actions.md); those routes must be implemented by your plugin.
