---
title: OpenCode and OpenChamber
description: How DevHub's dashboard, terminal, lazy OpenChamber tab, and lazy OpenCode tab work together.
order: 11
icon: Terminal
tags: [workflow]
related:
  - reference/scripts
  - reference/environment-variables
---

# OpenCode and OpenChamber

DevHub runs the dashboard and a localhost terminal during `npm run dev` / `npm run start`. OpenChamber and OpenCode are **not** always-on peers:

| Service     | Default port | Dashboard route | Role                              |
| ----------- | ------------ | --------------- | --------------------------------- |
| Dashboard   | `1337`       | `/`             | Main Next.js app                  |
| OpenChamber | `1336`       | `/chamber`      | Thinking/workspace UI (iframe)    |
| OpenCode    | ephemeral    | `/opencode`     | Lazy loopback instance; never 1338 |
| Terminal    | `1339`       | Docked drawer   | In-app PTY shell (WebSocket peer) |

DevHub does **not** start always-on OpenCode on `1338`, and does **not** start OpenChamber until you open `/chamber`. Always-on Chamber on 1336 spawned a second OpenCode that raced OpenChamber.app on `opencode.json`. The `/opencode` tab, session recap, and Datadog Investigate lazy-start a **loopback ephemeral** instance. Chamber (app or embed) starts and restarts its **own** OpenCode. DevHub never exports `OPENCODE_PORT` / `OPENCODE_SKIP_START` into Chamber.

The **terminal peer** is a separate localhost-only WebSocket PTY (`dashboard/scripts/terminal-pty-server.ts`). The docked terminal (`TerminalDock`) connects over `ws://127.0.0.1:1339` and keeps sessions alive while hidden — long-running commands (including PR reviews) continue when you switch tabs.

OpenChamber is **developer-managed**: DevHub does not bundle it. Install it yourself (`npm i -g @openchamber/web`, or point `OPENCHAMBER_BIN` at any build) and DevHub lazy-starts it when you open `/chamber`. When no `openchamber` is found on `PATH` (and `OPENCHAMBER_BIN` is unset), the Chamber tab and its iframe are hidden and nothing is started.

## Startup Flow

```text
npm run dev
-> start-peer-services.ts  -> free leftover OpenCode on 1338/4096; exit
                              (does not start OpenCode or OpenChamber)
-> terminal-pty-server.ts  -> WebSocket PTY on TERMINAL_PORT (default 1339)
-> dashboard (Next.js on PORT, default 1337)
     /chamber  -> GET /api/openchamber/listen -> OpenChamber on 1336
                  without OPENCODE_PORT / OPENCODE_SKIP_START
     /opencode -> GET /api/opencode/listen -> ephemeral loopback OpenCode
```

`start-peer-services.ts` only frees pinned OpenCode ports. `terminal-pty-server.ts` is the docked shell. `npm run dev` starts dashboard + peers boot + terminal + optional LAN proxy via `concurrently`. Peer boot calls `loadEnvWithOnePasswordFallback` so provider keys can be resolved from 1Password when local env vars are empty.

### Peer Versions

**DevHub does not update either peer.** They are tools you install and own; DevHub
just calls them. Keep them current yourself:

```bash
opencode upgrade
openchamber update
```

DevHub used to run both on every start. That cost ~7s of a ~24s boot to almost
always discover nothing had changed, and the OpenChamber path could trigger an
`npm install` that rewrote `node_modules` while Next was compiling — a hazard the
rest of the startup ordering existed to work around.

A missing binary is not an error: the relevant tab is simply hidden and the rest
of the dashboard works.

### Port Reuse

`ensureChamberListening()` is the single entry point (the `/chamber` tab, the desktop-app launcher, and Restart all call it; concurrent callers share one start). It reuses a healthy listener on 1336, but **replaces** a daemon whose env still has skip-start or `OPENCODE_PORT` (that leftover is what broke Setup). It also replaces a stale nvm binary. OpenCode listen never binds 1338/4096.

### OpenChamber → OpenCode Wiring

`cleanOpenChamberEnv()` (in `dashboard/lib/openchamber-command.ts`) **strips** the env that would make Chamber attach to DevHub's OpenCode as an external server it cannot restart:

- `OPENCODE_PORT`, `OPENCODE_HOST`, `OPENCODE_SKIP_START`
- `OPENCHAMBER_OPENCODE_PORT`, `OPENCHAMBER_SKIP_OPENCODE_START`, `OPENCHAMBER_INTERNAL_PORT`

It still sets `OPENCODE_BINARY` when `~/.opencode/bin/opencode` exists (unless `DEVHUB_OPENCODE_BINARY` overrides) so Chamber uses the same binary. Chamber then allocates and manages its own OpenCode port.

Do **not** set `OPENCODE_PORT` / `OPENCODE_SKIP_START` expecting Chamber to share DevHub's `1338` listener. That is what broke Claude/Cursor Setup.

## In-App Terminal

The docked terminal is opened from the bottom drawer (or programmatically via `devhub:terminal-open`). Each session spawns a login shell rooted at `DEVHUB_DEVELOPER_DIR` (default `~/Developer`) unless a `cwd` is passed.

Finished commands render as **block cards** (Warp-style) while the xterm grid stays mounted underneath — sessions must persist. Switch to the raw grid for full-screen apps or a long-running command that needs a real TTY. Each card can copy, rerun, send the command back to the prompt, or jump to that output in the raw grid.

| Trigger                            | Behavior                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Terminal drawer button             | Opens a new shell session at the developer directory                                                                              |
| PR **Review with agent** (`/prs`)  | Queues an **Agent** dock tab (or OpenCode session) with the `pr-explain-review` skill — not a PTY inject                          |
| Repo Learning **OpenCode handoff** | Opens a terminal in the target repo with a copied handoff prompt                                                                  |
| Repos **DX Audit**                 | Runs the `dx-audit` skill via the resolved AI provider                                                                            |
| Capability **Build lab**           | Runs the `capability-lab` skill in the kitchen-sink workspace                                                                     |
| MCP `terminal_propose_run`         | Queues a command; the dock shows confirm / edit / deny. **Never** injects stdin without that click                                |

The PTY server binds **localhost only** and has no authentication — acceptable because DevHub is a local-only tool. Do not expose port `1339` off-host.

Visible dock tabs heartbeat to `GET`/`POST /api/terminal/sessions` so MCP `terminal_list` can see label, cwd, kind, and busy state. Empty until the dock has opened at least once this process.

Agents that need a shell command use **propose-then-confirm**: `POST /api/terminal/propose` (MCP `terminal_propose_run`) stores an in-memory proposal (15 min TTL, max 20 pending). The dock must approve before inject. Poll `terminal_proposal_status` — do not assume the command ran. Destructive commands are flagged in the chip. `preferAgentTab` (default true) keeps long-running agents off a live `npm run dev` tab.

Each session's output is **tee'd to disk** (`DEVHUB_TERMINAL_LOG_DIR`, default `<tmpdir>/devhub-terminal-logs/<session-uuid>.log`) so **Copy all output** in the terminal drawer can return the full log via `GET /api/terminal/log?session=<uuid>`. Browser xterm scrollback is RAM-capped; the on-disk log is the source of truth for long PR reviews or builds. Session logs older than three days are pruned on terminal peer startup.

**Search closed sessions** from ⌘K (`GET /api/terminal/search`) — matches are secret-redacted. Selecting a hit opens a windowed read-only transcript (`GET /api/terminal/transcript`) with per-line and full-log copy. Use this for PR review or build output after the dock tab is gone; live tabs still prefer **Copy all output** (raw, unredacted).

If an interactive shell framework (powerlevel10k, ftazsh, etc.) deadlocks inside the embedded PTY, the server auto-respawns in safe mode after 4 seconds of silence. Override manually with `DEVHUB_TERMINAL_ARGS=-f` or `DEVHUB_TERMINAL_SHELL=/bin/bash` in `dashboard/.env.local`.

For PR review notes to land under `notes/pr-reviews/...`, set `NEXT_PUBLIC_REPO_ROOT` to the same path as `REPO_ROOT` (not auto-written by postinstall). See [GitHub integration](../integrations/github.md#review-note-constraints).

## Agent CLI selection

One **AI provider** (`DEVHUB_AI_PROVIDER`) covers in-app generation and agent launches. Values: `cursor-cli`, `chatgpt-cli`, `opencode`, `api`. Unset auto-picks the first installed/configured in that order. Configure from **/setup → AI Provider** or **Skills → Agent CLI**.

| Provider | Launch | Gate |
| -------- | ------ | ---- |
| `cursor-cli` | `cursor-agent -p … --force --model <model>` (default `cursor-grok-4.5-high`) | `cursor-agent` on `PATH` |
| `chatgpt-cli` | ChatGPT.app Codex binary, or `codex` / `chatgpt` on `PATH` | ChatGPT/Codex CLI present |
| `opencode` | `opencode run` (optional `--model`) | `opencode` installed |
| `api` | HTTP via `AI_API_KEY` | notes-AI configured |

`PUT /api/agent-cli` with a provider whose binary/key is missing returns `400`. Legacy `DEVHUB_AGENT_CLI` (`opencode` \| `cursor` \| `chatgpt`) still maps in; saving a provider writes both keys. Blank `opencodeModel` keeps the shared `opencode.json` default.

Agent/review jobs open the Agent dock tab or an OpenCode HTTP session (`dashboard/lib/agent-job.ts`). MCP `terminal_propose_run` still goes through the dock confirm chip onto a real PTY — never into the chat pane. Concurrent CLI runs are capped at `DEVHUB_AI_MAX_CONCURRENT` (default 3); queue wait is not counted against the job timeout.

Settings are managed `.env.local` keys so the 1Password `devhub` item can populate them like other managed config. Server read/detection: `dashboard/lib/ai/preference.ts` + `dashboard/lib/agent/cli-env.ts` (`GET`/`PUT /api/agent-cli`). Local CLIs see the same skills and notes MCP because sync writes them to `~/.cursor/skills` and `~/.cursor/mcp.json` as well as the OpenCode paths — run **Sync skills** / **Sync MCP** before first use.

## OpenCode Session Recap

Agents can summarize **what an OpenCode session did** (commands, MCP calls, file edits, failures) without replaying chat:

| Surface | Entry point                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------- |
| MCP     | `sessions_recap` on the `devhub` server                                                                   |
| Skill   | `devhub-recap` — call the tool and return the JSON unchanged                                              |
| HTTP    | `GET /api/opencode/recap` (requires `requireDashboardAuth`; see [API Routes](../reference/api-routes.md)) |

Open `/opencode` (or recap / Investigate) so DevHub can lazy-start OpenCode on an ephemeral loopback port. The recap builder reads the OpenCode HTTP API, redacts secrets, and omits prompts/reasoning. Use `directory` to scope sessions to a workspace.

## Configuration

### Environment Variables

| Variable                 | Default     | Purpose                                                         |
| ------------------------ | ----------- | --------------------------------------------------------------- |
| `DEVHUB_OPENCODE_BINARY` | —           | Override path to the `opencode` binary                          |
| `OPENCHAMBER_BIN`        | —           | Override path to the `openchamber` CLI                          |
| `OPENCHAMBER_HOST`       | `127.0.0.1` | OpenChamber local bind host; LAN access is proxied when enabled |

Do **not** set `OPENCODE_PORT`, `OPENCODE_HOST`, or `OPENCODE_SKIP_START`. Chamber's iframe uses 1336 internally; you do not need `OPENCHAMBER_PORT` / `NEXT_PUBLIC_*_PORT`.

See [Environment Variables](../reference/environment-variables.md) for 1Password-related keys.

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

The **Status** page probes whether Chamber (1336) or the lazy OpenCode instance is up via `/api/status/services`. Restart uses `/api/status/services/restart` (OpenCode comes back on a new ephemeral port).

**Actions** can launch native apps when installed:

- `/api/actions/launch-chamber` — OpenChamber Desktop pointing at the existing DevHub Chamber server (port `1336`)
- `/api/actions/launch-opencode` — macOS OpenCode Desktop app (when present under `/Applications`)
- `/api/actions/launch-claude` — Claude Desktop when installed; otherwise opens `https://claude.ai/new` in the browser. Available from the top-bar launch menu and command palette.
- `/api/actions/launch-chatgpt` — ChatGPT Desktop (`/Applications/ChatGPT.app`) when installed; otherwise opens `https://chatgpt.com` in the browser.

## Troubleshooting

| Symptom                                 | Things to check                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chamber iframe blank                    | Open `/chamber` so listen can start it; Status page Chamber indicator; `openchamber` on PATH                                                              |
| OpenCode won't start                    | `which opencode` or set `DEVHUB_OPENCODE_BINARY`; confirm nothing is still bound to 1338                                                                   |
| Provider auth errors                    | `/setup` or 1Password item fields; run sync after env vars are set; `DEVHUB_OP_REFRESH=1` once to refresh                                                 |
| LAN device can't reach Chamber          | Enable LAN mode in `/setup`; proxy is dashboard `1337` + Chamber `1336` only. OpenCode is loopback-only. On WSL, forward those ports from Windows (see root README) |
| Two OpenCode instances                  | Expected if both `/opencode` and Chamber are open — different ports. Do not point Chamber at 1338 via env                                                 |
| Claude/Cursor Setup fails in Chamber    | Something is still listening on 1338, or `OPENCODE_PORT`/`OPENCODE_SKIP_START` is in Chamber's env. Quit OpenChamber.app, confirm `lsof -iTCP:1338 -sTCP:LISTEN` is empty, reopen the app, then Setup. |
| Terminal drawer blank or stuck          | Terminal peer on `1339`; check `concurrently` `term` process. Heavy zsh themes may need `DEVHUB_TERMINAL_ARGS=-f`. Terminal is never LAN-proxied          |
| PR review note in wrong repo            | Set `NEXT_PUBLIC_REPO_ROOT` in `dashboard/.env.local` to match `REPO_ROOT`; restart dev server                                                            |

## Related Docs

- [Sync Engine](../architecture/sync-engine.md) — sync vs collect for shared assets
- [Desktop App](../getting-started/desktop-app.md) — packaged DevHub shell
- [Theming](theming.md) — OpenChamber theme install during postinstall
