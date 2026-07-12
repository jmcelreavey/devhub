# Installation

DevHub is designed to run locally on your machine. It does not require a hosted database or cloud deployment.

## Requirements

Before installing, make sure you have:

| Requirement          | Notes                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Node.js 20 or newer  | The dashboard and MCP server are Node-based                                                |
| Git                  | Used for repo sync, notes history, and workflow actions                                    |
| npm                  | Used by the root scripts and dashboard scripts                                             |
| Aikido Safe-Chain    | Blocks malicious packages at install time (see below)                                      |
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

Set this if you want secrets loaded into the process without writing them back to `dashboard/.env.local`:

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

The root install delegates to the dashboard install. Dashboard `postinstall` (`dashboard/scripts/postinstall.ts`) bootstraps `dashboard/.env.local` from `.env.example`, creates notes archive dirs, wires `.githooks/pre-push`, seeds OpenChamber themes, and materialises plugin branding. Postinstall is skipped in CI or when `DEVHUB_SKIP_POSTINSTALL` is set — use the [full bootstrap](#full-bootstrap) in that case.

## Run The Dashboard

```bash
npm run dev
```

Open the dashboard at:

```text
http://localhost:1337
```

Use development mode for normal day-to-day work. It reloads as files change.

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

The bootstrap process installs dashboard dependencies, wires git hooks, prepares notes directories, syncs shared configuration, and runs validation checks.

## MCP Server Dependencies

The `devhub` MCP server is a separate npm package at `mcp-servers/devhub-server/` with
its own `node_modules`. AI clients launch it via `tsx` from that package, not from the
root install.

DevHub auto-installs missing MCP package dependencies during:

- `npm run dev` (predev health check in `dashboard/scripts/health-check.ts`)
- Full bootstrap (`dashboard/scripts/bootstrap-install.ts`)

Enabled plugins with `mcp-servers/<name>/package.json` get the same treatment.

Manual recovery when an MCP client cannot start `devhub` or reports a missing `tsx`:

```bash
cd mcp-servers/devhub-server && npm install
# plugin example:
cd <plugin-root>/mcp-servers/<server-name> && npm install
```

Then re-run MCP sync from the dashboard Actions page.

## Verify The Install

```bash
npm run verify
```

This runs the dashboard lint, typecheck, and test commands.

## Common Problems

| Problem                         | Fix                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `safe-chain not installed`      | Run `npm install -g @aikidosec/safe-chain@1.1.10`, then `safe-chain setup`, and restart your terminal |
| Port 1337 is already in use     | Stop the existing DevHub process or use the Electron app to restart it                                |
| Optional integration is missing | Open `/setup` and add the relevant credentials                                                        |
| Skills or MCP configs are stale | Run the sync actions from the dashboard                                                               |
| MCP client cannot start `devhub` | Run `cd mcp-servers/devhub-server && npm install`, then re-run MCP sync                              |
| Plugin MCP server fails to start | Run `npm install` inside the plugin's `mcp-servers/<name>/` package, then re-run MCP sync            |
| Push is blocked by tests        | Run `npm run verify` locally and fix the reported issue                                               |
