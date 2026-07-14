# OpenCode and OpenChamber

DevHub runs three cooperating local services during `npm run dev` and `npm run start`:

| Service     | Default port | Dashboard route | Role                             |
| ----------- | ------------ | --------------- | -------------------------------- |
| Dashboard   | `1337`       | `/`             | Main Next.js app                 |
| OpenChamber | `1336`       | `/chamber`      | Thinking/workspace UI (iframe)   |
| OpenCode    | `1338`       | `/opencode`     | Coding assistant web UI (iframe) |

OpenCode is a **shared peer service**. OpenChamber connects to the same `opencode serve` instance instead of starting its own embedded server.

OpenChamber is **developer-managed**: DevHub does not bundle it. Install it yourself (`npm i -g @openchamber/web`, or point `OPENCHAMBER_BIN` at any build) and DevHub serves it on `OPENCHAMBER_PORT` and embeds it. When no `openchamber` is found on `PATH` (and `OPENCHAMBER_BIN` is unset), the Chamber tab and its iframe are hidden and nothing is started.

## Startup Flow

```text
npm run dev
  -> start-peer-services.ts  -> opencode serve on OPENCODE_PORT (default 1338)
                             -> openchamber serve on OPENCHAMBER_PORT (default 1336)
                                with OPENCODE_SKIP_START=true
  -> dashboard (Next.js on PORT, default 1337)
```

Startup lives in `dashboard/scripts/start-peer-services.ts` (chained), with `start-opencode.ts` available for standalone OpenCode use. It calls `loadEnvWithOnePasswordFallback` before binding ports so provider keys can be resolved from 1Password when local env vars are empty. OpenChamber is only started when a system install is detected.

### Peer Version Updates

On every DevHub start (`npm run dev` / `npm run start`), `ensure-peers-current.ts` best-effort upgrades **OpenCode** before binding ports:

| Peer        | Mechanism                                               | Pin behavior                                                            |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| OpenCode    | Runs `opencode upgrade` (no-op when already current)    | Updates the user-installed binary; takes effect on the next clean start |
| OpenChamber | **Not updated by DevHub** — you manage your own install | Whatever version you have installed is what DevHub serves               |

The OpenCode check is **non-fatal** — offline, registry errors, or upgrade failures keep the existing binary and DevHub continues.

| Variable                      | Set to | Effect                           |
| ----------------------------- | ------ | -------------------------------- |
| `DEVHUB_SKIP_OPENCODE_UPDATE` | `1`    | Skip `opencode upgrade` on start |

See [Environment Variables](../reference/environment-variables.md) for the full list.

### Port Reuse

If a port is already listening, the startup script assumes the service is already running and keeps the npm/concurrently process alive without starting a duplicate listener.

This lets you attach DevHub to an existing OpenCode session. For OpenChamber, startup also reuses an existing listener on `OPENCHAMBER_PORT`, but shutdown still runs `openchamber stop`. In practice, if DevHub attaches to an already-running OpenChamber on that port, exiting DevHub may stop that existing OpenChamber instance as well.

### OpenChamber → OpenCode Wiring

`cleanOpenChamberEnv()` (in `dashboard/lib/openchamber-command.ts`) sets:

- `OPENCODE_PORT` to the shared DevHub port
- `OPENCODE_SKIP_START=true` so OpenChamber does not spawn a second `opencode serve`
- `OPENCODE_BINARY` when `~/.opencode/bin/opencode` exists (unless `DEVHUB_OPENCODE_BINARY` overrides)

OpenChamber waits up to 30 seconds for OpenCode to listen before starting its own daemon.

## Configuration

### Environment Variables

| Variable                       | Default     | Purpose                                                         |
| ------------------------------ | ----------- | --------------------------------------------------------------- |
| `OPENCODE_PORT`                | `1338`      | `opencode serve --port`                                         |
| `OPENCODE_BIND_HOST`           | `127.0.0.1` | `opencode serve --hostname`; LAN access is proxied when enabled |
| `NEXT_PUBLIC_OPENCODE_PORT`    | `1338`      | Port in the browser iframe URL                                  |
| `DEVHUB_OPENCODE_BINARY`       | —           | Override path to the `opencode` binary                          |
| `OPENCHAMBER_PORT`             | `1336`      | OpenChamber daemon port                                         |
| `OPENCHAMBER_HOST`             | `127.0.0.1` | OpenChamber local bind host; LAN access is proxied when enabled |
| `NEXT_PUBLIC_OPENCHAMBER_PORT` | `1336`      | Port in the Chamber iframe URL                                  |
| `OPENCHAMBER_BIN`              | —           | Override path to the `openchamber` CLI                          |

Legacy `OPENCODE_HOST` is still read as a bind host when it is not a full URL; prefer `OPENCODE_BIND_HOST` for new setups.

See [Environment Variables](../reference/environment-variables.md) for 1Password-related keys.

### Agent CLI (OpenCode vs Cursor)

One-shot terminal handoffs (PR review, DX audit, capability labs, repo upstart) default to `opencode run`, but can be switched to the Cursor CLI (`cursor-agent -p … --force --model <model>`, default `cursor-grok-4.5-high`) from **/setup → Agent CLI** or **Skills → Agent CLI**. The Cursor option only appears when `cursor-agent` is installed. An optional OpenCode model override (`opencode run --model provider/model`) can be set the same way; blank keeps the shared `opencode.json` default.

Settings are managed `.env.local` keys — `DEVHUB_AGENT_CLI`, `DEVHUB_AGENT_OPENCODE_MODEL`, `DEVHUB_AGENT_CURSOR_MODEL` — so the 1Password `devhub` item can populate them like other managed config. Server read/detection: `dashboard/lib/agent-cli-env.ts` (+ `/api/agent-cli`); command builders: `dashboard/lib/terminal-launch.ts` (`agent*Command`, async). Both CLIs see the same skills and notes MCP because sync writes them to `~/.cursor/skills` and `~/.cursor/mcp.json` as well as the OpenCode paths — run **Sync skills** / **Sync MCP** before first use.

### Shared OpenCode Config

Source of truth: `opencode/shared/opencode.json` in the repo.

Sync copies only these curated keys into `~/.config/opencode/opencode.json`:

- `model`
- `small_model`
- `provider`
- `theme`

Everything else in the local file (MCP block, `$schema`, agents, model catalogue entries OpenCode manages) is left untouched.

Provider API keys in the shared file must use OpenCode placeholders: `{env:VAR_NAME}`. Never commit raw secrets. On sync, DevHub resolves placeholders from `process.env` (including values loaded by the 1Password fallback) and writes concrete values only into the local config.

**Dashboard:** Agents → OpenCode → edit shared config → **Sync OpenCode**.

**API:** `GET` / `PUT` `/api/opencode` reads and updates the shared file; `PUT` rejects JSON that contains raw secrets at secret-like keys.

## 1Password Secret Fallback

Before dev services start, `dashboard/scripts/op-secrets.ts` can populate missing secret env vars from a 1Password item (default title: `devhub`).

| Variable            | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `DEVHUB_OP_ITEM`    | 1Password item title (default: `devhub`)           |
| `DEVHUB_OP_VAULT`   | Pin vault when multiple items share the same name  |
| `DEVHUB_OP_REFRESH` | Set to `1` to bypass `.env.op-synced` and re-fetch |

After a successful fetch, a marker file `dashboard/.env.op-synced` avoids repeated `op` calls on every restart. Path-only keys (`NOTES_DIR`, bind hosts, etc.) are never fetched from 1Password.

Managed secret names come from the dashboard env allowlist plus any `{env:VAR}` referenced in the shared OpenCode config, so new providers do not require code changes.

## Status and Restarts

The **Status** page probes OpenChamber and OpenCode ports via `/api/status/services`. Restart actions use `/api/status/services/restart` and respect the same port env vars.

**Actions** can launch native apps when installed:

- `/api/actions/launch-chamber` — OpenChamber Desktop pointing at the existing DevHub server (port `1336` / shared OpenCode on `1338`)
- `/api/actions/launch-opencode` — macOS OpenCode Desktop app (when present under `/Applications`)

## Troubleshooting

| Symptom                                 | Things to check                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Chamber iframe blank                    | OpenCode listening on `OPENCODE_PORT`; Status page service indicators                                                                        |
| OpenCode won't start                    | `which opencode` or set `DEVHUB_OPENCODE_BINARY`; port `1338` not held by another process                                                    |
| Provider auth errors                    | `/setup` or 1Password item fields; run sync after env vars are set; `DEVHUB_OP_REFRESH=1` once to refresh                                    |
| LAN device can't reach Chamber/OpenCode | Enable LAN mode in `/setup`; it starts the LAN proxy for `1336` and `1338`. On WSL, still forward those ports from Windows (see root README) |
| Two OpenCode instances                  | Should not happen when `OPENCODE_SKIP_START=true`; if you run `opencode serve` manually, let DevHub reuse that port                          |

## Related Docs

- [Sync Engine](../architecture/sync-engine.md) — sync vs collect for shared assets
- [Electron App](../getting-started/electron-app.md) — desktop launcher for all three ports
- [Theming](theming.md) — OpenChamber theme install during postinstall
