---
title: Terminal and agent CLI
description: The docked terminal, which CLI one-shot AI jobs use, OpenCode session recap, and the shared OpenCode config.
order: 5
icon: Terminal
tags: [workflow]
related:
  - guides/paseo-agents
  - reference/scripts
  - reference/environment-variables
---

# Terminal and agent CLI

`npm run dev` / `npm run start` run the dashboard and a localhost terminal peer. Coding chats are on **Agents** (`/agents`), backed by Paseo — see [Agents (Paseo)](paseo-agents.md). This page covers what is left around them: the docked terminal, the CLI used for one-shot AI jobs, OpenCode session recap, and the shared OpenCode config.

| Service   | Default port   | Where                 | Role                                      |
| --------- | -------------- | --------------------- | ----------------------------------------- |
| Dashboard | `1337`         | `/`                   | Main Next.js app                          |
| Agents    | Paseo `:6767`  | `/agents`             | Coding chats, activity, usage             |
| Terminal  | `1339`         | Docked drawer         | In-app PTY shell (WebSocket peer)         |
| OpenCode  | ephemeral      | none                  | Lazy-started only for session recap       |

`/chamber` and `/opencode` redirect to `/agents`. DevHub no longer starts, embeds or updates OpenChamber, and never pins OpenCode to `1338`.

## Startup Flow

```text
npm run dev
-> start-peer-services.ts  -> prints a note and exits (Paseo runs under launchd)
-> terminal-pty-server.ts  -> WebSocket PTY on TERMINAL_PORT (default 1339)
-> dashboard (Next.js on PORT, default 1337)
     /agents -> Paseo web UI (managed daemon :6767)
-> lan-port-proxy.ts       -> only when LAN mode is on
```

Paseo runs independently, so opening or closing DevHub never kills an agent. Peer boot calls `loadEnvWithOnePasswordFallback` so provider keys can be resolved from 1Password when local env vars are empty.

## In-App Terminal

The docked terminal is opened from the bottom drawer (or programmatically via `devhub:terminal-open`). Each session spawns a login shell rooted at `DEVHUB_DEVELOPER_DIR` (default `~/Developer`) unless a `cwd` is passed.

Finished commands render as **block cards** (Warp-style) while the xterm grid stays mounted underneath — sessions must persist. Switch to the raw grid for full-screen apps or a long-running command that needs a real TTY. Each card can copy, rerun, send the command back to the prompt, or jump to that output in the raw grid.

Blocks come from shell integration: zsh is started with `ZDOTDIR` pointed at a temp dir whose `.zshrc` sources yours and then adds OSC 133 prompt marks. Set `DEVHUB_TERMINAL_SHELL_INTEGRATION=0` to turn that off.

Pasting or dropping an image into the dock writes it to `DEVHUB_TERMINAL_PASTE_DIR` (default `<tmpdir>/devhub-terminal-paste`) and types the absolute path at the prompt, so CLI agents can read it.

| Trigger                            | Behavior                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Terminal drawer button             | Opens a new shell session at the developer directory                                                                              |
| PR **Review with agent** (`/prs`)  | Opens the Agents handoff sheet and starts a Paseo agent with `pr-explain-review` — not a PTY inject                      |
| Repo Learning **OpenCode handoff** | Opens a terminal in the target repo with a copied handoff prompt                                                                  |
| Repos **DX Audit**                 | Opens the Agents handoff sheet for the `dx-audit` skill                                                                            |
| Capability **Build lab**           | Runs the `capability-lab` skill in the kitchen-sink workspace                                                                     |
| MCP `terminal_propose_run`         | Queues a command; the dock shows confirm / edit / deny unless **Auto-run** is on (destructive commands still confirm) |

The PTY server binds **localhost only** and checks an exact loopback `Origin`. Desktop sessions also require a short-lived ticket fetched through the authenticated dashboard. Checkout sessions have no desktop token. Keep port `1339` off-host.

Visible dock tabs heartbeat to `GET`/`POST /api/terminal/sessions` so MCP `terminal_list` can see label, cwd, kind, and busy state. Empty until the dock has opened at least once this process.

Agents that need a **shell command** use **propose-then-confirm**: `POST /api/terminal/propose` (MCP `terminal_propose_run`) stores an in-memory proposal (15 min TTL, max 20 pending). The dock must approve before inject **unless** the dock **Auto-run** toggle is on (`localStorage` key `devhub:terminal-autorun`). Auto-run skips the chip for ordinary commands and injects into a new tab immediately. Destructive patterns (`rm -rf`, `git push --force`, `kubectl delete`, `DROP TABLE`, … — `isDestructiveTerminalCommand`) **always** keep the confirm modal. Poll `terminal_proposal_status` — do not assume the command ran. Every approved (or auto-run) proposal opens its own tab, so a run never waits on another session.

An MCP proposal does not raise the dock if you have put it away (⌃` or the top-bar button): the terminal button gets its unread dot and the chip waits there. A tab opened for an MCP command closes itself about four seconds after that command exits with code 0, which also ends its shell; a non-zero exit leaves the tab open to read. Tabs you open, and agents you launch yourself, are never closed for you. Middle-click any tab to close it.

MCP `agent_dispatch` / `POST /api/agent/runs` do **not** use this queue — they create a Paseo agent. See [Agents (Paseo)](paseo-agents.md).

Each session's output is **tee'd to disk** (`DEVHUB_TERMINAL_LOG_DIR`, default `<tmpdir>/devhub-terminal-logs/<session-uuid>.log`) so **Copy all output** in the terminal drawer can return the full log via `GET /api/terminal/log?session=<uuid>`. Browser xterm scrollback is RAM-capped; the on-disk log is the source of truth for long PR reviews or builds. Session logs older than three days are pruned on terminal peer startup.

**Search closed sessions** from ⌘P (`GET /api/terminal/search`) — matches are secret-redacted. Selecting a hit opens a windowed read-only transcript (`GET /api/terminal/transcript`) with per-line and full-log copy. Use this for PR review or build output after the dock tab is gone; live tabs still prefer **Copy all output** (raw, unredacted).

If an interactive shell framework (powerlevel10k, ftazsh, etc.) deadlocks inside the embedded PTY, the server auto-respawns in safe mode after 4 seconds of silence. Override manually with `DEVHUB_TERMINAL_ARGS=-f` or `DEVHUB_TERMINAL_SHELL=/bin/bash` in `dashboard/.env.local`.

For PR review notes to land under `notes/pr-reviews/...`, set `NEXT_PUBLIC_REPO_ROOT` to the same path as `REPO_ROOT` (not auto-written by postinstall). See [GitHub integration](../integrations/github.md#review-note-constraints).

## Agent CLI selection

One **AI provider** (`DEVHUB_AI_PROVIDER`) covers in-app generation and agent launches. Values: `cursor-cli`, `chatgpt-cli`, `antigravity-cli`, `opencode`, `api`. Unset auto-picks the first installed/configured in that order. Configure from **/setup → AI Provider** or **Skills → Agent CLI**.

| Provider | Launch | Gate |
| -------- | ------ | ---- |
| `cursor-cli` | `cursor-agent -p … --force --model <model>` (default `cursor-grok-4.5-high`) | `cursor-agent` on `PATH` |
| `chatgpt-cli` | ChatGPT.app Codex binary, or `codex` / `chatgpt` on `PATH` | ChatGPT/Codex CLI present |
| `antigravity-cli` | `agy -p … --dangerously-skip-permissions` (optional `--model`) | `agy` on `PATH` or a known user bin (`~/.local/bin`, Homebrew, …) |
| `opencode` | `opencode run` (optional `--model`) | `opencode` installed |
| `api` | HTTP via `AI_API_KEY` | notes-AI configured |

`PUT /api/agent-cli` with a provider whose binary/key is missing returns `400`. Legacy `DEVHUB_AGENT_CLI` (`opencode` \| `cursor` \| `chatgpt` \| `antigravity`) still maps in; aliases `agy` / `antigravity` resolve to `antigravity-cli`. Saving a provider writes both keys. Blank `opencodeModel` keeps the shared `opencode.json` default. Optional `DEVHUB_AGENT_ANTIGRAVITY_MODEL` is passed as `agy --model`.

There is no Antigravity desktop IDE in DevHub — the repo-hub Terminal split can still open `agy` in the dock. Interactive leftover launches use `agy --dangerously-skip-permissions` (same idea as Claude skip-permissions). Coding work from Implement / Review / MCP dispatch goes through Paseo instead.

`launchAgentJob` opens the Agents handoff sheet for agent-like kinds. MCP `terminal_propose_run` still goes through the dock confirm chip onto a real PTY — never into the chat pane — unless the user has Auto-run on for non-destructive commands. Concurrent CLI generations are capped at `DEVHUB_AI_MAX_CONCURRENT` (default 3); queue wait is not counted against the job timeout.

Settings are managed `.env.local` keys so the 1Password `devhub` item can populate them like other managed config. Server read/detection: `dashboard/lib/ai/preference.ts` + `dashboard/lib/agent/cli-env.ts` (`GET`/`PUT /api/agent-cli`). Local CLIs see the same skills and notes MCP because sync writes them to `~/.cursor/skills`, `~/.cursor/mcp.json`, `~/.gemini/config/skills`, and `~/.gemini/config/mcp_config.json` as well as the OpenCode paths — run **Sync skills** / **Sync MCP** before first use.

## OpenCode Session Recap

Agents can summarize **what an OpenCode session did** (commands, MCP calls, file edits, failures) without replaying chat:

| Surface | Entry point                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------- |
| MCP     | `sessions_recap` on the `devhub` server                                                                   |
| Skill   | `devhub-recap` — call the tool and return the JSON unchanged                                              |
| HTTP    | `GET /api/opencode/recap` (requires `requireDashboardAuth`; see [API Routes](../reference/api-routes.md)) |

The first recap lazy-starts a **loopback, ephemeral-port** OpenCode server and reuses it afterwards. The recap builder reads the OpenCode HTTP API, redacts secrets, and omits prompts/reasoning. Use `directory` to scope sessions to a workspace. When `OPENCODE_SERVER_PASSWORD` is set, DevHub sends Basic auth (`opencode:<password>`).

Recap only sees OpenCode sessions. For Claude Code, Codex or Cursor work, recap from the agent's own history.

## Configuration

### Environment Variables

| Variable                   | Default | Purpose                                                   |
| -------------------------- | ------- | --------------------------------------------------------- |
| `DEVHUB_OPENCODE_BINARY`   | —       | Override path to the `opencode` binary                    |
| `OPENCODE_SERVER_PASSWORD` | —       | Basic-auth password for the lazy OpenCode recap server    |

Do **not** set `OPENCODE_PORT`, `OPENCODE_HOST` or `OPENCODE_SKIP_START`; the recap server picks its own port. See [Environment Variables](../reference/environment-variables.md) for terminal and 1Password keys.

### Shared OpenCode Config

Source of truth: `opencode/shared/opencode.json` in the repo.

Sync copies only these curated keys into `~/.config/opencode/opencode.json`:

- `model`
- `small_model`
- `provider`
- `theme`

Everything else in the local file (MCP block, `$schema`, agents, model catalogue entries OpenCode manages) is left untouched.

Provider API keys in the shared file must use OpenCode placeholders: `{env:VAR_NAME}`. Never commit raw secrets. On sync, DevHub resolves placeholders from `process.env` (including values loaded by the 1Password fallback) and writes concrete values only into the local config.

**Dashboard:** Skills → Agent CLI → edit shared config → **Sync OpenCode**.

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

## Troubleshooting

| Symptom                                 | Things to check                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recap fails to start OpenCode           | `which opencode`, or set `DEVHUB_OPENCODE_BINARY`                                                                                                |
| Provider auth errors                    | `/setup` or 1Password item fields; run sync after env vars are set; `DEVHUB_OP_REFRESH=1` once to refresh                                        |
| Agents shows disconnected               | See [Agents (Paseo) — Troubleshooting](paseo-agents.md); Status → Services shows whether the daemon answers                                    |
| Terminal drawer blank or stuck          | Terminal peer on `1339`; check the `concurrently` `term` process. Heavy zsh themes may need `DEVHUB_TERMINAL_ARGS=-f`. Terminal is never LAN-proxied |
| PR review note in wrong repo            | Set `NEXT_PUBLIC_REPO_ROOT` in `dashboard/.env.local` to match `REPO_ROOT`; restart dev server                                                   |

## Related Docs

- [Agents (Paseo)](paseo-agents.md) — coding chats, dispatch and usage
- [Sync Engine](../architecture/sync-engine.md) — sync vs collect for shared assets
- [Desktop App](../getting-started/desktop-app.md) — packaged DevHub shell
