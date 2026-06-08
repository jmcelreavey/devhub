# Plugin System

Plugins let a separate repo (or local directory) contribute assets — skills, agents, MCP
configs — into DevHub without living in the core repo. This keeps company-specific or
private content (e.g. `devhub-bi`) out of the shareable core while still syncing it to
your tools. See `TEMPLATE_AND_PLUGIN_PLAN.md` for the broader template/fork strategy.

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
