---
name: devhub-plugin-workflow
description: Use when developing, editing, or reviewing a DevHub Tier-2 dashboard plugin (a separate repo like devhub-bi that contributes pages/API routes/libs/components into core). Covers the edit -> materialize -> verify loop, dashboard.paths in devhub-plugin.json, the overwrite-on-restart gotcha, and client-safe lib rules. Trigger phrases — "edit the bi plugin", "add a card to ops", "why did my plugin change disappear", "verify a plugin change", "sync_plugins".
metadata:
  short-description: Develop a DevHub dashboard plugin
---

# DevHub Plugin Workflow

## Overview

A Tier-2 plugin (e.g. `devhub-bi`) is a **separate repo** that ships Next.js dashboard
code — pages, API routes, libs, components — into the core DevHub dashboard. The plugin
has **no standalone build**: its files are _materialized_ (copied) into core at the same
relative path, and core compiles them as if they were its own.

This skill is the day-to-day dev loop. For the design/reference see
`docs/architecture/plugins.md`; for first-time scaffolding see
`docs/guides/creating-plugins.md`.

## When To Use

- Editing or adding plugin dashboard code (a new Ops card, API route, lib).
- A plugin change "disappeared" or didn't take effect after a server restart.
- Reviewing a plugin PR and you need to actually run tsc/eslint/vitest on it.
- Adding a new file to a plugin and wiring it into `devhub-plugin.json`.

## The golden rule: edit source, never the copy

- **Source of truth** is the plugin repo (`~/Developer/devhub-bi/...`).
- The copies under core (`~/Developer/devhub/dashboard/...`) are **materialized
  artifacts**. They are git-ignored in core and **overwritten on every `sync_plugins`**
  (wired into `predev`/`prebuild`/`prestart`, so a server restart re-materializes).
- If you edit the core copy directly, your change is silently clobbered on the next
  restart. Always edit the plugin repo, then re-materialize.

## Workflow

1. **Edit the plugin source** in the plugin repo (e.g. `devhub-bi/dashboard/...`).

2. **Register new files.** Any _new_ file must be listed in `devhub-plugin.json`
   under `dashboard.paths` (paths are relative to the plugin's `dashboard.root`).
   Editing an already-listed file needs no manifest change. Bump `version` when the
   contributed surface changes.

3. **Materialize into core** — run from the **core** dashboard dir:

   ```bash
   cd ~/Developer/devhub/dashboard && npx tsx scripts/run-action.ts sync_plugins
   ```

   The materializer copies each path, **refuses to overwrite git-tracked core files**
   (core always wins on collision), and prunes paths no longer contributed.

4. **Verify against the core copy** (the plugin can't build alone), from core dashboard:

   ```bash
   npx tsc --noEmit
   npx eslint <materialized paths>      # build lint is --max-warnings 0
   npx vitest run <materialized test>
   ```

5. **Commit in the plugin repo**, not core. The core copies are git-ignored; nothing to
   commit there. Use a feature branch + conventional commit in the plugin repo, and
   exclude `.devhub/` from staging.

## Rules

- **Never commit `.devhub/`.** Before committing plugin work, confirm `git diff --cached --name-only` contains no `.devhub/` paths; unstage them with `git restore --staged -- .devhub` if needed.
- **Client-safe libs:** a lib imported by a client component (`"use client"`) must have
  **no Node imports** (`node:fs`, `child_process`, etc.). Put shared pure logic (command
  string builders, types) in a client-safe module; keep `fs`/`exec` server-only.
- **Resolve paths server-side.** Never build host/user absolute paths on the client.
  Pass a name and resolve it server-side with traversal guards.
- **Core wins collisions.** Don't try to shadow a core file from a plugin — the
  materializer refuses to overwrite git-tracked core paths.
- **State-changing API routes** must guard with `isSameOrigin(req)` (see existing
  `app/api/bi/*` routes), especially anything that shells out.
- Keep secrets/private hostnames out of committed plugin code.

## Verification

- `sync_plugins` prints each `plugin → path` it copied — confirm your new files appear.
- `npx tsc --noEmit` clean, `eslint` clean (0 warnings), targeted `vitest run` green.
- If a change won't show in the running app, re-run `sync_plugins` (or restart the dev
  server) — you were likely looking at a stale or pre-overwrite copy.
