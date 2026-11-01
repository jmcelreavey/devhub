---
title: Plugin system
description: "How a separate repo contributes assets and reviewed runtime features."
order: 7
icon: Blocks
tags: [architecture, plugins]
related:
  - contributing/creating-plugins
  - guides/theming
  - architecture/database-client
---

# Plugin System

Plugins let a separate repo (or local directory) contribute assets — skills, agents, MCP
configs — into DevHub without living in the core repo. This keeps company-specific or
private content (e.g. `team-tools`) out of the shareable core while still syncing it to
your tools. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the broader template/fork strategy.

The plugin loader is a generalisation of the original `ai-tools` skill merge: instead of
one hard-coded upstream, any number of registered plugins merge alongside core, with
**core winning on name collisions**.

Plugins contribute skills, agents and MCP configuration through asset sync. Pages,
navigation, themes, providers and services use reviewed runtime contributions. Core
never copies plugin dashboard source into the checkout; a manifest with `dashboard`
is rejected. See the [runtime example](../../templates/runtime-plugin/README.md).

> Building one? See the step-by-step [Creating a Plugin](../contributing/creating-plugins.md) guide.
> This page is the design/reference.

## Packaged runtime plugins

An optional `runtime` manifest field adds a separate delivery path. `runtime.api: "1"` and `transport: "request-worker"` identify a prebuilt `.mjs` bundle committed alongside its dependency lockfile. Both have SHA-256 pins. The GitHub installer reviews the exact commit, permissions and files before **Trust and enable**. It never builds the plugin or installs its dependencies.

Core ships fixed dynamic host routes once. Each request launches the bundled Node through `execExternal`, with a 30-second deadline, a 64 KB request limit and a 2 MB response limit. Only declared pages, API methods/paths and MCP server names are reachable. Pages render in a sandboxed frame with an opaque origin; a small message bridge can invoke only that plugin's declared APIs. MCP is stateless HTTP, registered for new DevHub-managed Paseo sessions. Existing sessions must be restarted to acquire new servers.

Managed runtime installs use an approval receipt that holds manifest and source-tree hashes outside the plugin directory. Changed files refuse execution. Disable blocks new work and cancels active workers; remove keeps downloads and plugin data, matching existing removal behaviour. Updates currently require remove, add and fresh consent.

Local runtime bundles can use the same managed registration without a GitHub download:

```bash
npm run plugins -- add-runtime /path/to/plugin
# Review the permissions and hashes, then repeat with the digest printed above:
npm run plugins -- add-runtime /path/to/plugin --trust <plan-digest>
```

The first command only reviews a snapshot. The second checks those inputs again, saves
an approved copy under managed plugin storage and registers its runtime immediately.
It does not publish skills and agents. Open, disable,
re-enable or remove it from Plugins without rebuilding the dashboard. Source edits need
a fresh install and consent; they do not change the approved copy. A same-named local
or managed registration is never replaced. Existing `plugins add` registrations keep their local asset sync path.

The child receives only declared environment variables, its own HOME/temp folder and a controlled PATH. Node filesystem permissions confine ordinary file access to the plugin and its data. Exec is separately declared. This is **not a sandbox against hostile code**: server network declarations are disclosures, and permitted child processes can escape Node's restrictions. All runtime plugins are labelled high risk. Checksums do not verify publisher identity.

`permissions.write` grants named paths beneath the host home, separately from
read-only `permissions.read`. Both reject traversal and symlinked paths. Keep
writable scopes as narrow as the feature permits; the review lists each one.

`capabilities.settings: [{ "path": "/profile", "keys": ["AWS_PROFILE"] }]`
allows that non-streaming POST route to return `{ ok: true, hostSettings:
{ AWS_PROFILE: "profile-name" } }`. The key must also be in `permissions.publicEnv`.
Core saves only this patch to its existing settings file, retains unrelated
settings, and removes `hostSettings` from the response. The worker cannot read
the settings file. Failed, malformed, cancelled, replaced and concurrently
changed responses cannot save a patch. Only `AWS_PROFILE` is supported today.

`permissions.notes` can separately request specific top-level folders in the
existing notes vault, for example `[{ "path": "appraisal", "write": true }]`.
Each reviewed grant is read-only unless `write` is true. The host resolves the
vault and rejects symlinked scopes before launching the worker, then supplies
only those folder paths in `DEVHUB_PLUGIN_NOTE_SCOPES` and Node's filesystem
permissions. An injected host context must supply its own `NOTES_DIR`; it cannot
fall back to another vault. Notes stay in place when a plugin is replaced or
disabled. Plugins must still validate note content and use atomic writes.

Runtime branding supports dark/light colour presets, PNG/WebP logos and WOFF2 fonts. Choose **Use {label} branding** on the plugin page. It does not replace signed app icons or inject arbitrary CSS. Disabling removes the active contribution within the next refresh (up to ten seconds), without overwriting the saved core theme.

Source-only modules, overlays and native addons require migration to runtime plugins. See the [runtime plan](../plans/runtime-plugins-and-node.md) for migration limits and the [portable example](../../templates/runtime-plugin/README.md) for the executable contract.

#### Reviewed host reads

A runtime may bind `capabilities.reads` to a declared non-streaming GET route.
The available sources are `github.prs`, `jira.issues` and `datadog.alerts` (the
optional Datadog integration provider). The review lists each route and source.
Core appends a version-one `hostReads` snapshot with its configured origin and
allowlisted work metadata; public callers cannot provide that field. Other
routes and MCP calls receive no snapshot. Credentials, account configuration
and arbitrary host HTTP access stay outside the worker.

PR lists are bounded to 100 authored and 100 review rows, Jira to 40 issues and
alerts to 20 rows per group; each string is limited to 4,096 characters.
Optional source failures produce null entries, preserving partial results.
Preparation has a ten-second deadline under the worker's active-call lease;
caller cancellation, disable and replacement retire it before a worker starts.
Native reads retain their own network/subprocess deadlines. Caller input stays
limited to 64 KiB; the combined snapshot and input must fit one MiB. Workers
that declare reads must accept that input size. Core rechecks the reviewed
snapshot before launch. Read preparation is never replayed as a write.

## Headless runtime toolsets

A managed snapshot can expose its existing tool names through the core stdio peer,
without a running dashboard or importing a plugin module. Ship this descriptor at
the plugin root as `devhub-mcp-toolsets.json`:

```json
{
  "version": 2,
  "toolsets": [{ "name": "example", "runtime": "example", "tools": ["example_read"] }]
}
```

`runtime` names a server declared in `runtime.mcp`. The descriptor and bundle are
covered by the same review receipt. `DEVHUB_MCP_TOOLSETS` selects these toolsets
alongside core toolsets; unselected workers do not start. Core checks tool and
toolset collisions before loading any plugin. It obtains the selected inventory
from the restricted worker and refuses missing, extra or duplicate tool names.
Object input schemas, field descriptions and annotations pass through the core
registrar. The worker validates arguments with its original schema; unsupported
tool metadata fails closed. Calls use the existing
worker limits, filesystem grants, cancellation and secret redaction. Disable or
replacement retires existing proxies; restart the MCP peer to acquire new tools.
Version-one source descriptors remain available only to local source registrations.
Managed snapshots never import their source registrar.

#### Runtime database providers

Declare `runtime.capabilities.database: { "id": "provider-namespace" }` to offer database connections. The review and consent digest cover this capability; unknown capabilities and the reserved `local` namespace are rejected. No provider code is imported into core. Existing source providers stay available until migrated; codegen records their plugin owner so a disabled or damaged managed replacement cannot fall back to compiled source code.

Core sends internal worker requests with `kind: "database"`, `method: "POST"` and a `path` of `list`, `preflight`, `resolve` or `invalidate`. These requests cannot be invoked through the public runtime HTTP endpoint. Responses are limited to 256 KB; list and invalidation have a three-second deadline, preflight and resolve thirty seconds. A reviewed `database.listTimeoutSeconds` can raise a cold list's limit to at most thirty seconds; warm lists should use the provider's cache. Disable or replacement cancels active calls.

- `list` returns up to 500 `DbConnectionRef` objects **without `source`**. Core supplies the plugin origin. IDs must use the declared namespace and be unique. Warm lists must be cheap, without network or credential fetches, and core caches them for thirty seconds. Registration and reviewed public-setting changes bypass that cache immediately.
- `preflight` receives `{ id, accessMode }` (read by default) and returns `DbPreflight`. Remedies may only call the same plugin's declared POST API routes and always require machine-state confirmation.
- `resolve` receives `{ id }` and returns `ResolvedDbConnection` to the server pool only. Engine, ID, access mode and dangerous flags must match the listing. SQLite's read-only flag must agree too. Core keeps its existing read-only and typed production-write confirmations.
- `invalidate` returns `null` after dropping provider state. Core waits for it before listing or resolving again.

Public responses use strict field validation and redact declared environment values. Worker failures return a fixed error without stdout, stderr or schema values. Hosts, usernames, passwords, URIs and SQLite paths belong only in `resolve`; never include credentials in labels, checks or other public metadata.

#### Runtime integration providers

Declare `runtime.capabilities.integrations` as an array of `{ id, label, capabilities }` entries. Each capability must be a supported read, alert, transition or standard issue/PR write action. Reviews cover the complete list. Provider IDs still conflict with core or other plugins rather than replacing them. Generated source providers carry their plugin owner and are suppressed when that owner has a managed registration, including disabled or damaged snapshots.

Internal requests use `kind: "integration"`, `method: "POST"` and a body containing `provider`. Supported paths are `accounts`, `setupStatus`, `get` (`ref`), `alerts` (`limit`), `transitions` (`ref`), `prepareWrite` (`input`) and `executeWrite` (`input`, `prepared`, `requestId`). Accounts and setup have three-second limits; other calls thirty seconds. Responses are bounded to 256 KB. These operations are unavailable through the public runtime HTTP endpoint. Accounts and setup calls may be async for source providers too.

Core validates provider/account identity, references, response shapes, capabilities and HTTP(S) links. Standard write inputs allow a runtime provider ID while retaining the native Jira/GitHub action, key, account and traversal checks. Jira task linking applies only to Jira writes. Prepared writes contain no credentials and are bound to the same input, unmodified preparation, adapter and reviewed snapshot for sixty seconds. Sending consumes the preparation. A disabled or updated worker refuses it; an uncertain or malformed execution response stays an unknown outcome in the existing write journal and is never replayed automatically.

Workers can report an explicit refusal as `{ error: { kind, retryAfter? } }` using an existing integration error kind. Core supplies the public message; worker stderr and error bodies are never forwarded. Public data redacts declared environment values, while preparation and receipt documents containing those values are rejected. Keep credentials inside the worker and use `native` only for the request and revision evidence required to execute the prepared action.

#### Runtime host slots

Declare `runtime.capabilities.slots` entries with `{ id, location, label, routes }`.
Locations are `repo`, `setup` and `task`; each route declares `path`, `method` and a
required `confirmation` message for writes. Slot IDs and route/method pairs must
be unique. Reviews include the context access and confirmation text.

Core lists enabled slots live and renders their HTML using the same opaque-origin
frame as runtime pages. Internal worker calls use `kind: "slot"`, the slot ID as
`path`, and a body containing server-resolved `context`. `GET` returns HTML;
`POST` includes an `action: { path, method, body? }` and returns JSON. Slot routes
are separate from ordinary runtime APIs and cannot be called through that endpoint.
The existing `devhub:api`, `devhub:cancel` and `devhub:result` frame messages apply.
Escape sends `devhub:close` to dismiss the frame's own host dialog, when present.

Repo context contains a scanned repo's name and resolved path. Task context
contains its canonical ID, creation identity, title, note path, active profile and
read-only state. Core ignores supplied descriptions and paths, refuses stale
profiles or task identities, and checks ownership and closed state before each
write. Setup receives only its location. Public responses redact declared secrets.
The host binds calls to the reviewed manifest revision, confirms writes outside
the frame, and offers Stop. Cancellation never retries a submitted action;
plugins must preserve their own prepared-write and idempotency checks. Views are
removed on disable or replacement without changing core fallbacks or saved data.

#### Runtime background services

Declare `runtime.capabilities.service: { id, label, maxRunSeconds }` for a
connection worker. The limit is 30–86,400 seconds. Installation leaves it off:

In Plugins, open the plugin's details and review its background service. Approve
the reviewed snapshot there, or turn the service off from the same control.

Consent covers the complete reviewed snapshot; replacement needs fresh service
consent. Only the primary dashboard (`DEVHUB_SCHEDULER` other than `0`) starts
services. Core sends `{ kind: "service", path: id, method: "START" }` on stdin
and applies the same scoped environment, Node permissions and persistent plugin
data directory as request workers. Services are internal, with no HTTP invocation.

One cross-process lease covers each plugin. The child joins that lease before
loading plugin code and stops its process group if its dashboard dies. Disable,
revocation, changed bytes and shutdown cancel the connection. Windows services
that request subprocess access fail closed until process-tree cleanup is supported.
Other Windows service behaviour still needs target verification.

Each run has a deadline and a 256 KiB ceiling per output stream. Core discards
output and exposes only generic lifecycle states. Unexpected exits reconnect with
backoff, stopping after five short-lived failures; explicit service approval
retries a failed service. Core never queues or replays action requests. The
worker must persist delivery IDs and preserve its own write/idempotency checks.

The reviewed `board-snapshot` service task reads cards and workflow records for
an available task profile. Without the `run-usage` grant it omits run usage,
error and review enrichment. With that grant it reads scoped run data without
importing or reconciling runs in the active profile. Its `uncertainRunState` is
true when open, owned task runs cannot be verified. Consumers must not act on uncertain
run state. If a failure acknowledgement cannot be verified, the snapshot reports
an error. Service task responses are limited to 2 MiB; an oversized snapshot fails
instead of returning a partial board.

#### Reviewed runtime theme assets

`runtime.capabilities.themes` declares up to eight presets with complete dark/light
palettes. Core accepts only its existing colour tokens and colour syntax. Core
preset IDs are reserved; a collision between plugins hides both contributions.
An effect surface must declare its preferences. Sound must be off by default;
each declared WAV has a volume cap of 0.25.

The review hashes every declared HTML, static PNG/WebP, WOFF2 and WAV asset.
Animated images and executable image formats are refused. HTML is limited to
256 KiB; other theme assets to 4 MiB. A preset may declare up to 32 named images,
with a 16 MiB ceiling across its distinct images. `/api/plugins/themes` returns
`{ themes, managedPlugins }`: approved, enabled themes and managed owner names.
Managed replacements suppress their compiled legacy presets and components even
when disabled or unavailable. Asset requests name a declared asset and its current revision,
never a file path. Disabled, changed and stale snapshots fail closed. HTML is
returned as JSON for the sandbox host, never as a dashboard-origin document.
Binary assets support bounded byte ranges so WebKit can decode reviewed sounds.
Runtime presets appear in Appearance without rebuilding. Validated palettes apply
before first paint, and palette/font rules are scoped to the reviewed revision.
The live catalogue refreshes on focus and every ten seconds. Disable or replacement
retires the old scene and audio; unavailable themes fall back to Graphite while
retaining the saved preset and effect preferences for re-enable.

Effect HTML runs in a passive, opaque-origin `allow-scripts` frame, outside React's
component tree. It cannot read the dashboard DOM, storage or APIs. Its CSP blocks
network resources, nested frames, workers and direct media playback. Core fetches
declared images and supplies bounded data URLs. Use a runtime page or slot for
interactive controls; effect frames cannot receive focus or pointer input.

The frame receives `devhub:theme-state` events with the preset, mode, effective
preferences, motion/visibility/editing state, viewport size and image data URLs
keyed by declared asset ID. `devhub:theme-event` carries pointer coordinates
(suppressed over editors), the `boo` shortcut outside editors, and task/merge
celebrations. No typed text, task content or arbitrary DOM access crosses this
bridge. `window.devhubTheme.play(id)` and `.stop(id)` can request only declared
sounds. Core binds messages to the current frame and nonce, caps play requests,
and requires both the saved sound preference and a real user gesture. Saved sound
does not autoplay after reload. Visibility, master and sound switches stop playback.

For a `readableScene`, `pointerEffects` can name up to eight declared preferences
that independently enable mouse events. Coordinates remain rounded to eight
pixels and are suppressed over protected areas and during editing. Pointer events
also carry `overContent`: hide any follower there; eyes and other remote reactions
can still respond. Without this declaration the existing cursor-only gate applies.

`fogLayer: true` creates a second copy of the surface. Its state has `layer: "fog"`;
the normal surface has `layer: "scene"`. The plugin must draw each part only in
its respective layer. Core applies a wider, feathered mask and room envelope to
the fog layer, and its regular protected-content mask to both. Protected text and
editor rectangles stay in the host. Both copies receive the same `sceneEpoch`
(milliseconds since epoch) for synchronising their timed effects. Only the scene
copy receives input events or may request audio.

`staticSurface: true` opts a readable surface into reduced-motion rendering in
place of `staticImage` or `staticLayers`. The state has `motion: false` and
preferences already adjusted for reduced motion. The surface must render still
content, schedule no animation or events, and honour the effective preferences;
core suppresses CSS animations and transitions and sends no interaction events.
This preserves scalable textures and independently masked fog without a flattened
viewport image. Sound remains governed by its own preference.

An audio entry may use `trigger: "random"` with `loop: false` and a `schedule`
of `initialMin`, `initialMax`, `min`, and `max` seconds (1–3600). An optional
`rate: [min, max]` randomises playback speed between 0.5 and 2. Core schedules
the bounded sounds only after activation, and cancels timers on hide, disable or
retirement. Frames cannot trigger or stop scheduled sounds.

Reduced motion and the motion kill-switch otherwise replace the script surface with its
optional static image. Hidden tabs remove the scene. Palette and logo remain when
effects are off. Scene errors stop that scene and appear in Appearance; plugin
error details are not sent to the host. Runtime themes are reviewed before use.

Docs and persona-modes are not yet plugin-aware (different delivery mechanisms).

## File-copy assets and MCP packages

Assets mirror core directories and merge into the same catalogs:

```
team-tools/
  devhub-plugin.json
  agents/<name>.md
  skills/<name>/SKILL.md
  mcp/<name>.json
  mcp-servers/<name>/package.json   # optional stdio server package
```

`mcp/<name>.json` is the canonical MCP catalog entry. It can point at a command that
already exists on the machine, or it can point at a server package shipped by the
plugin under `mcp-servers/<name>/`. Plugin MCP configs may use `PLUGIN_ROOT` in
`command`, `args`, or `env`; `sync-mcp` replaces it with the plugin's registered
path. Use `REPO_ROOT` only for paths inside the DevHub core checkout.

During bootstrap and the dashboard health check, DevHub scans enabled plugins for
`mcp-servers/*/package.json` and runs `npm install` where `node_modules` is missing.
That keeps plugin stdio servers self-contained instead of pretending one
top-level `node_modules` can somehow satisfy every package on earth. It cannot.

## Runtime dashboard features

Runtime plugins declare reviewed pages, APIs, providers and branding in their manifest.

Navigation comes from the reviewed live runtime catalogue. `runtime.pages` supplies
palette destinations; optional `runtime.nav` metadata supplies labels, icons, groups,
setup gates, sidebar visibility and Library/Settings section tabs. Its `href` must name
a declared page alias or that page's canonical `/plugins/runtime/<name>?page=…` URL.
Core constructs the links and follows plugin events, so enable, disable and reviewed
replacement need no rebuild. Unreviewed source registrations contribute no shell links.

Legacy page URLs use reviewed `runtime.aliases`. Core checks them against its compiled
route inventory and all managed owners, including disabled plugins. A conflict or bad
navigation target hides that plugin's entries and points to Plugins; core namespaces
always keep their routes. Use `group: "infra"` for infrastructure destinations. The
existing infrastructure setup gate still applies.

API aliases can use named single-segment parameters, for example
`/api/example/runs/[runId]`. Core passes them in `body.params` alongside
`body.query`, rejects overlapping aliases for the same method, and accepts only
letters, digits, `_` and `-` in parameter values. Targets remain declared,
non-streaming runtime routes. Empty write bodies are forwarded without a `body`
field; the target validates whether that is allowed.

### Database connections and branding

Runtime plugins declare database providers and branding assets in their reviewed
runtime manifest. See [runtime database providers](#runtime-database-providers)
and [reviewed runtime theme assets](#reviewed-runtime-theme-assets).

## Manifest

Each plugin repo has a `devhub-plugin.json` at its root:

```json
{
  "name": "team-tools",
  "version": "0.1.0",
  "devhubApi": "1",
  "navGate": "infra",
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

`apps/ui/scripts/check-plugin-requirements.mjs` runs in **`preinstall`**: it reads the
machine-local registry, and for each *enabled* plugin verifies every required `command`
resolves on `PATH`. If one is missing it prints the `install` hint and fails the install.

This is how the **example plugin requires `safe-chain`** while the public template does not — a
fresh fork with no plugins registered hits no requirements at all; the gate only bites once
you register a plugin that opts in. The check is dependency-free (it runs before
`node_modules` exists) and tolerant — a missing/broken registry or manifest is skipped,
never fatal.

Layout inside a plugin mirrors core:

```
team-tools/
  devhub-plugin.json
  agents/<name>.md            # flat .md files (like agents/shared)
  skills/<name>/SKILL.md      # one dir per skill
  mcp/<name>.json             # one canonical server JSON per file
  mcp-servers/<name>/          # optional stdio server package
```

## Registry (machine-local, never committed)

Register and manage plugins from the DevHub repo root:

```bash
npm run plugins -- add ~/Developer/team-tools
npm run plugins -- list                 # enabled, valid plugins
npm run plugins -- disable team-tools
npm run plugins -- enable team-tools
```

Mutations validate the manifest and registry, preserve unrelated settings and write
atomically. Restart the dashboard to apply them, then use Skills → Sync for AI tools.

`~/.config/devhub/plugins.json` lists which plugins this machine has and whether they're
enabled (same home as the `mcp-personal/` catalog):

```json
{
  "plugins": [
    { "name": "team-tools", "path": "~/Developer/team-tools", "enabled": true }
  ]
}
```

`path` accepts `~`. Disabled entries, missing paths, name/manifest mismatches, and
invalid manifests are skipped (logged), never fatal — one bad plugin can't break sync.


## Installing from a GitHub URL

The Plugins page (`/plugins`) installs a public or private repository after a review.
Private repositories use the GitHub CLI or Git credential helper that is already
configured for the account running DevHub. DevHub does not store or print tokens.

The URL has to be `https://github.com/<owner>/<repo>`, with an optional `.git`
suffix. SSH URLs, other hosts, `/tree` and `/blob` links, query strings, fragments,
and embedded usernames or tokens are rejected. The installer follows the
repository's default branch.

`npm run plugins -- add-from-url <url>` performs that same download and validation
and prints the review. It does not enable the plugin. Confirming an install is an
in-app step. A folder you already have is still registered with
`npm run plugins -- add <path>`, which enables it immediately and can replace an
local entry of the same name. It cannot replace a managed registration; use
Plugins to review, enable, disable or remove managed installations.

A GitHub install will not replace a plugin that is already registered under that
name from another path.

Managed entries live in the same `plugins.json`. Existing entries stay valid:
missing `enabled` means enabled, and missing `managed` means you own the folder.
Managed entries add an id, `managed: true`, and a `source` object. `plugins add`
does not rewrite older entries just to add those fields.

`npm run plugins -- list --all` includes disabled plugins and registrations that need attention (a missing folder, an invalid manifest, a name that does not match, or a duplicate name). `list --json` shortens paths to `<home>` or `<path>` and does not include command output or credentials.

Managed downloads live in the app-data plugins directory, or in `DEVHUB_PLUGIN_HOME` when that is set. Skill and agent copies are written under the account home unless `DEVHUB_PLUGIN_TARGET_HOME` is set. `DEVHUB_CONFIG_DIR` selects only the registry directory; it does not retarget `~/.claude` or the other tool folders.

Disabling a managed plugin removes the unchanged copies it installed and keeps the download. Removing it drops the registry entry and also keeps the download. A copy edited after install is left in place and listed in the result. On Windows the service runs in WSL, so the download, Git credentials and tool copies are inside that distribution, not in a Windows-only GitHub CLI login.

General Skills/Agents sync leaves managed copies alone, including edited copies
kept after removal. Only the targets selected in Plugins receive those assets.
Install writes are journaled before copying. After an interrupted apply, Plugins
shows the recorded locations and offers **Retry cleanup**. It removes unchanged
copies only; an already enabled plugin must first be disabled from its details.

Plugin API routes require the desktop session and same-origin proof, a valid
`X-DevHub-Secret`, or a browser session on a known loopback-only listener.
Start checkout dashboards through the provided launcher so the API knows the
actual listener address. An unknown listener fails closed for browser access.

```bash
npm run plugins -- list            # enabled plugins, as before
npm run plugins -- list --all      # disabled and broken registrations too
npm run plugins -- list --json     # paths shortened; no credentials
```

`DEVHUB_CONFIG_DIR`, when set, is the only registry directory DevHub reads.
It does not fall back to `~/.config/devhub/plugins.json`.

This installer enables skills and agents. A plugin that also contributes MCP
servers, legacy branding, docs, or persona modes is shown
in the review and is not enabled. Nothing from the repository runs before you
confirm, and an incompatible plugin is not registered.

Scaffold a new plugin without registering or publishing it:

```bash
npm run plugins -- new team-tools --out ~/dev/team-tools
npm run plugins -- new team-tools --out ~/dev/team-tools --dry-run
```

The scaffold includes a runtime page, its lockfile and matching hashes. Use
`plugins add-runtime <path>` to review a local copy.

## Precedence and read-only

- Skill order: **core → vendor → plugins → ai-tools**. Enabled plugins are an
  explicit local choice and override same-named ai-tools skills; core and vendor
  skills still win. Plugin registry order resolves plugin-to-plugin collisions.
- Plugin assets are **read-only** in DevHub — edit them in the plugin repo. The Skills
  and Agents APIs mark them `readOnly`, the UI hides edit/delete, mutating routes return
  403, and collect never pulls them back into `skills/shared` / `agents/shared`.
- Origin is exposed as `core` or `plugin:<name>` (see `apps/ui/lib/plugins/types.ts`).

## Where it lives

| Concern | File |
| ------- | ---- |
| Types / origin | `apps/ui/lib/plugins/types.ts` |
| Manifest reader (zod) | `apps/ui/lib/plugins/manifest.ts` |
| Registry + asset-dir resolution | `apps/ui/lib/plugins/registry.ts` |
| Agent merge | `apps/ui/lib/sync/agents.ts` (`resolveAgentSources`) |
| Skill merge | `apps/ui/lib/skill-catalog.ts` (`buildMergedSkillCatalog`) |
| MCP merge | `apps/ui/lib/sync/mcp.ts` (`pluginMcpServers`, `readCatalogMcpServer`) |

## ai-tools

`ai-tools` remains its own merge path (`AI_TOOLS_ROOT`) today; conceptually it is "the
first plugin" and is slated to fold into this mechanism as a registered plugin. Until
then, both run side by side and core still wins over both.
