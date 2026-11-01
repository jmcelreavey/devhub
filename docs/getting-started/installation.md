---
title: Installation
description: "Get DevHub running locally: prerequisites, Safe-Chain, install, and first launch."
order: 1
icon: Download
tags: [setup]
related:
  - getting-started/setup
  - reference/platform-support
---

# Installation

DevHub is designed to run locally on your machine. It does not require a hosted database or cloud deployment.

## Requirements

Before installing, make sure you have:

| Requirement          | Notes                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Node.js 22           | Pinned in `.nvmrc` — run `nvm install && nvm use`                                          |
| Git                  | Used for repo sync, notes history, and workflow actions                                    |
| npm 10               | Bundled with Node 22. `npm install` refuses npm 11, which rewrites the lockfile CI rejects  |
| Aikido Safe-Chain    | Required by the full bootstrap script and by plugins that declare it (see below)                                      |
| A supported terminal | macOS Terminal, iTerm, Warp, or a WSL terminal work well                                   |
| 1Password CLI        | Recommended before first run so DevHub can load integration secrets from the `devhub` item |

Optional integrations may also need tools like the GitHub CLI, 1Password CLI, or cloud provider CLIs.

## Safe-Chain

Install and enable Safe-Chain before running `npm install`:

```bash
npm install -g @aikidosec/safe-chain@1.1.10
safe-chain setup
```

Restart your terminal after `safe-chain setup`. Verify the guard is active:

```bash
npm install safe-chain-test
```

Expected: install is blocked with a Safe-Chain error (the package is a known test artifact).

## 1Password Secret Bootstrap

On a new machine, set up 1Password before the first dashboard run if you want Jira, Google Calendar, Datadog, AI provider (`AI_API_KEY`), and OpenCode provider credentials to appear automatically.

```bash
# macOS example; use the official 1Password CLI install for other platforms.
brew install --cask 1password-cli
op signin
```

Create or sync a 1Password item titled `devhub`. Add fields named exactly after the env vars, such as `JIRA_API_TOKEN`, `DATADOG_API_KEY`, `DATADOG_APPLICATION_KEY`, and `AI_API_KEY`.

Set this if you want secrets loaded into the process without writing them back to `apps/ui/.env.local`:

```bash
export DEVHUB_OP_CACHE=0
```

DevHub startup calls the 1Password fallback automatically. The browser `/setup` page then shows which integrations are configured. For CLI diagnostics, run:

```bash
npm run doctor
```

## Install From The Repo Root

```bash
npm install
```

The root install installs every workspace together. Dashboard `postinstall` (`apps/ui/scripts/postinstall.ts`) bootstraps `apps/ui/.env.local` from `.env.example`, creates notes archive dirs, wires `.githooks/pre-push`. Postinstall is skipped in CI or when `DEVHUB_SKIP_POSTINSTALL` is set — use the [full bootstrap](#full-bootstrap) in that case.

## Run The Dashboard

```bash
DEVHUB_BIND_HOST=127.0.0.1 npm run dev
```

On macOS, Linux and WSL, an unsupervised checkout defaults to <http://localhost:1437>, with its terminal on port `1439` and HTTP MCP on `1440`. The installed app keeps its usual ports. Development mode reloads as files change; the checkout leaves scheduled jobs and shared dashboard discovery to the primary instance.

Shell-supervised Attach keeps the legacy dashboard port `1337` and terminal port `1339`. Existing environment or `apps/ui/.env.local` values take precedence on every platform; use the URL printed at startup. If older settings still select the installed app's ports, override them for the checkout. For example:

```bash
PORT=1437 TERMINAL_PORT=1439 DEVHUB_MCP_HTTP_PORT=1440 DEVHUB_SCHEDULER=0 npm run dev
```

The Windows app may select a different port when availability changes. Changing its WebView origin can leave unsent drafts and focus state at the old address.

If no other DevHub instance is running and this checkout should own background work, start it with `DEVHUB_SCHEDULER=1 npm run dev`.

## Production Mode

```bash
npm run build
npm run start
```

Production mode is useful when you want a faster, more stable local dashboard and do not need live reload.

## Full Bootstrap

For a new machine, use the bootstrap script:

```bash
bash scripts/install.sh
```

The bootstrap process installs dashboard and MCP dependencies, wires git hooks, prepares notes directories, syncs shared configuration, builds the dashboard, and runs validation checks. A failed step returns a non-zero exit status with the error, so fix it and re-run the command.

A fresh public clone uses the shared engineering standards. Add your personal identity from **Persona** or `persona/identity.txt` in your private mirror when ready; it is optional for startup.

## MCP Server Dependencies

The `devhub` MCP server is the `packages/mcp/` workspace and uses the root
install. AI clients launch `bin/devhub-mcp.mjs`, which builds or reuses an
esbuild bundle and falls back to `tsx` if needed.

Enabled plugins with `mcp-servers/<name>/package.json` are installed separately
by the health check and full bootstrap.

Manual recovery when an MCP client cannot start `devhub` or reports a missing `tsx`:

```bash
npm ci # at the repo root
# plugin example:
cd <plugin-root>/mcp-servers/<server-name> && npm install
```

Then re-run MCP sync from the dashboard Actions page.

## Verify The Install

```bash
npm run verify
```

This checks the MCP server types, then runs dashboard lint, typecheck, tests, vendored-skill checks and a production build.

## Common Problems

| Problem                         | Fix                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `safe-chain not installed`      | Run `npm install -g @aikidosec/safe-chain@1.1.10`, then `safe-chain setup`, and restart your terminal |
| `This project pins npm 10`      | Run `nvm use` (or install Node 22), then re-run the install                                           |
| Port 1337 is already in use     | Keep the existing instance running and use the separate-port command above |
| Optional integration is missing | Open `/setup` and add the relevant credentials                                                        |
| Skills or MCP configs are stale | Run the sync actions from the dashboard                                                               |
| MCP client cannot start `devhub` | Run `npm ci` at the repo root, then re-run MCP sync                              |
| Plugin MCP server fails to start | Run `npm install` inside the plugin's `mcp-servers/<name>/` package, then re-run MCP sync            |
| Push is blocked by tests        | Run `npm run verify` locally and fix the reported issue                                               |
