---
title: Setup
description: Configure paths, ports, and optional integrations from the /setup page instead of hand-editing env files.
order: 2
icon: Settings
tags: [setup]
related:
  - reference/environment-variables
  - getting-started/installation
---

# Setup

The setup page is the safest place to configure DevHub after installation.

Open:

```text
http://localhost:1337/setup
```

## What Setup Controls

| Area            | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Core paths      | Where DevHub stores notes and finds the repo                                |
| Network access  | Whether the dashboard is local-only or reachable on your LAN                |
| Google Calendar | Optional calendar widget and calendar page                                  |
| Jira Cloud      | Optional ticket views and standup support                                   |
| Datadog         | Optional alert summaries and deep links                                     |
| GitHub          | Pull request and repo-related features, usually via the GitHub CLI          |
| Infra           | Optional internal infrastructure helpers, when an infra plugin is installed |
| Notes AI        | Optional OpenAI-compatible BlockNote AI — **env vars only** (see below)     |

## Core Settings

Most core settings are created automatically during install.

| Setting         | Meaning                                                      |
| --------------- | ------------------------------------------------------------ |
| Notes directory | Where BlockNote notes, diagrams, and learnings are stored    |
| Repo root       | The DevHub checkout used by scripts and sync actions         |
| Dashboard port  | The local port used by the web app                           |
| Bind host       | Whether DevHub is localhost-only or also proxied to your LAN |

## Localhost Vs LAN Access

By default, DevHub services bind to `127.0.0.1`. LAN mode keeps localhost working and starts a small proxy on the detected physical LAN IPv4.

The `auto` LAN detector excludes Tailscale/VPN CGNAT addresses (`100.64.0.0/10`) by default. In normal use, enabling LAN access exposes DevHub on Wi‑Fi/Ethernet, not Tailscale.

Use localhost-only mode when:

- You only use DevHub from the current machine.
- You are on an untrusted network.
- You want the safest default.

Use LAN mode when:

- You want to open DevHub from a phone or tablet on the same Wi-Fi.
- You trust the network.
- You understand that DevHub has no built-in authentication.

LAN mode exposes these ports through the proxy: dashboard `1337`, OpenChamber `1336`, OpenCode `1338`, and terminal `1339`.

When opening DevHub from another device at `http://<lan-ip>:1337` during **`npm run dev`**, Next.js 16+ blocks `/_next/*` chunk requests unless the browser `Origin` matches an allowlisted host pattern. DevHub ships defaults for common private ranges (`192.168.*.*`, `10.*.*.*`, `172.*.*.*`, `*.local`). If the UI stays on loading skeletons from a phone or tablet, add your host pattern to `DEVHUB_ALLOWED_DEV_ORIGINS` in `dashboard/.env.local` (comma-separated) and restart. Production `npm run start` does not use this dev-only gate.

For sensitive routes such as OpenCode session recap, set `DEVHUB_API_SECRET` in `dashboard/.env.local` (and in MCP env when using `sessions_recap`) so LAN clients cannot call them without the shared secret. See [Environment Variables](../reference/environment-variables.md#core-variables).

## Optional Integrations

Integrations are optional. DevHub should still run without them.

If an integration is not configured, the related pages or widgets either hide themselves or show a setup prompt.

## Secrets

Secrets should live in local environment configuration or a secret manager. Do not commit real tokens to the repo.

The shared configuration files should use environment variable placeholders instead of raw secrets.

### AI Features (not on this page)

Notes AI, Repo Learning generated artifacts, and morning-briefing AI use `AI_API_KEY` in `dashboard/.env.local` (any OpenAI-compatible provider — z.ai by default, or OpenAI, OpenRouter, etc. via `AI_BASE_URL`/`AI_MODEL`). Copy the example lines from `dashboard/.env.example`, restart after changes, and see [Environment Variables](../reference/environment-variables.md#notes-repo-learning-and-briefing-ai-optional).

## After Changing Setup

Some settings are picked up immediately. Changes that affect local listeners, such as LAN proxy host or core paths, may require restarting DevHub.

## Setup API

The `/setup` wizard reads and writes configuration through local API routes (same-origin on mutating calls):

| Route | Purpose |
| ----- | ------- |
| `GET /api/setup/status` | Drives nav item visibility, integration toggles, and peer-service gates. Returns booleans for each integration plus `*Vars` previews (key presence, not secret values). |
| `POST /api/setup/save` | Persists core paths, network/LAN settings, and integration credentials to `DEVHUB_ENV_FILE` (`dashboard/.env.local` in a checkout, `<app-data>/config/.env.local` when installed). |
| `POST /api/setup/validate-path` | Validates `reposDir` (code folder), `notesDir`, or the optional `repoRoot` checkout before save. |
| `POST /api/setup/check/datadog` | Tests Datadog API + application keys against the Events API. |

The Status page service cards (`chamber`, `opencode`) also read `chamber` / `opencode` from `GET /api/setup/status` — they render only when the corresponding peer is enabled.

See [API Routes](../reference/api-routes.md) for response field details.

## DevHub Desktop App

The Setup completion screen shows desktop status rather than a build button.

Running **in the desktop app**, it reports the installed version, where your
data lives, and that updates arrive in-app. Running **in a browser**, it links
to Releases.

Building an installer is a developer command, not an onboarding step:

```bash
npm run desktop:build     # build and ad-hoc sign
npm run desktop:install   # replace /Applications/DevHub.app, with safety checks
```

The old `POST /api/setup/install-app` route built an Electron bundle from your
checkout and has been removed — it asked somebody already using DevHub to build
DevHub. See [Desktop Development](../guides/desktop-development.md) for the
full build, sign and release pipeline, and [Desktop App](desktop-app.md) for the
user-facing side.
