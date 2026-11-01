---
name: devhub-plugin-workflow
description: Develop or debug a DevHub runtime plugin such as team-tools. Use when editing plugin pages, APIs, MCP servers or services, or when a plugin change does not show up.
metadata:
  short-description: Develop a DevHub runtime plugin
---

# DevHub Plugin Workflow

## Overview

A plugin (e.g. `team-tools`) is a **separate repo**. Its pages, APIs, MCP servers,
themes and services run from a prebuilt runtime bundle (`runtime` in
`devhub-plugin.json`) that DevHub reviews, pins by hash and launches as a separate
worker. Core never copies plugin dashboard source into the checkout; a manifest with
`dashboard` is rejected. Skills, agents and MCP configuration still use asset sync.

Design/reference: `docs/architecture/plugins.md`. Scaffolding:
`docs/contributing/creating-plugins.md`.

## When To Use

- Editing or adding a plugin page, API route, MCP server or service.
- A plugin change didn't take effect in the running app.
- Reviewing a plugin PR and you need to run its checks.

## The golden rule: edit source, then re-review

- **Source of truth** is the plugin repo. The approved copy under managed plugin
  storage is read-only and hash-checked; changed files refuse execution.
- A source edit never changes the approved copy. Rebuild the bundle in the plugin
  repo, then review and trust the new snapshot.

## Workflow

1. **Edit the plugin source** and rebuild its runtime bundle and lockfile with the
   plugin's own build script. Update the pinned hashes it generates. Bump `version`
   when the contributed surface changes.
2. **Test in the plugin repo** with its own checks (for example
   `node --test runtime/*.test.mjs`).
3. **Review the snapshot** from the DevHub root:

   ```bash
   npm run plugins -- add-runtime <plugin-directory>
   ```

   This only prints permissions, files and the plan digest.
4. **Trust it** in the app (Plugins → Add local plugin → Review → Trust and enable)
   or with `--trust <plan-digest>` when you are authorised to grant trust. Background
   services need their own review and approval.
5. **Commit in the plugin repo**, not core. Exclude `.devhub/` from staging.

## Rules

- **Never commit `.devhub/`.** Before committing plugin work, confirm `git diff --cached --name-only` contains no `.devhub/` paths; unstage them with `git restore --staged -- .devhub` if needed.
- Declare every page, API method/path, MCP server, permission and environment
  variable in the manifest; undeclared ones are unreachable.
- Keep writable scopes as narrow as the feature permits.
- Validate input in the worker; resolve paths server-side with traversal guards.
- Keep secrets/private hostnames out of committed plugin code.

## Verification

- `add-runtime` review shows the expected files, permissions and hashes.
- The plugin's own tests pass, and the page or API works through the host after trust.
- If a change won't show, you are running the previously approved snapshot: review
  and trust the new one.
