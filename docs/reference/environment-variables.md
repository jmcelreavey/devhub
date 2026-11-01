---
title: Environment variables
description: "Every variable DevHub reads: paths, ports, integrations and secrets."
order: 2
icon: KeyRound
tags: [reference]
related:
  - getting-started/setup
  - reference/scripts
---

# Environment Variables

DevHub uses local environment variables for paths, ports, integrations, and secrets.

Most values live in the dashboard's local environment file and can be edited from `/setup`.

## Core Variables

| Variable                       | Purpose                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTES_DIR`                    | Directory for notes, learnings, and diagrams                                                                                                                                                                                                                                                                                                                                          |
| `DOCS_DIR`                     | Optional override for repo docs (default: `REPO_ROOT/docs`)                                                                                                                                                                                                                                                                                                                           |
| `TASKS_DIR`                    | Optional override for the tasks directory (default: `REPO_ROOT/tasks`). Items live in `<dir>/items/`. Point elsewhere to keep personal data out of the tree |
| `DEVHUB_TASK_MIGRATION_DIR`    | Where the one-time task import stores its backup and report. Default: `$DEVHUB_CONFIG_DIR/task-migrations` or `~/.config/devhub/task-migrations` |
| `DEVHUB_PROFILE` | Which task profile (`tasks/<profile>/`) this machine writes to; overrides `~/.config/devhub/profile.json`. See [Task profiles](../guides/task-profiles.md) |
| `DEVHUB_CONFIG_DIR` | Machine-local config dir (default `~/.config/devhub`) — holds the active task profile |
| `REPS_DIR`                     | Optional override for daily review reps (default: `REPO_ROOT/reps`) — same personal-data boundary as tasks; **not** included in content-sync paths                                                                                                                                                                                                                                    |
| `COLLECTIONS_DIR`              | Optional override for checklist collections (default: `REPO_ROOT/collections`)                                                                                                                                                                                                                                                                                                        |
| `UPSTARTS_DIR`                 | Optional override for per-repo Upstart scripts (default: `REPO_ROOT/upstarts`)                                                                                                                                                                                                                                                                                                        |
| `REPO_ROOT`                    | DevHub repository root                                                                                                                                                                                                                                                                                                                                                                |
| `DEVHUB_REPOS_DIR`             | Directory scanned for sibling git repos on **Repos** (default: parent of `REPO_ROOT`, or the code folder chosen in `/setup`). Saved via `POST /api/setup/save` as `reposDir`.                                                                                                                                                                                                          |
| `NEXT_PUBLIC_REPO_ROOT`        | Browser-visible checkout path for terminal handoffs and Upstart script paths. Set to the same path as `REPO_ROOT` in `apps/ui/.env.local`; postinstall doesn't populate it. Paseo review runs get their notes location from the server-side MCP config.                                                                                     |
| `PORT` | Dashboard port. Unsupervised checkout dev defaults to `1437` (including WSL); shell-supervised and installed/start use `1337`. Explicit settings win. |
| `DEVHUB_MCP_HTTP_PORT` | Port for the HTTP MCP entry: `1440` for unsupervised checkout dev, `1340` otherwise. |
| `DEVHUB_MCP_HTTP_HOST`          | Bind address for the HTTP MCP entry (default `127.0.0.1`)                                                                                                                                                                                                                                                                                                                             |
| `DEVHUB_MCP_HTTP_TOKEN`         | Bearer token for the HTTP MCP entry (min 32 chars); overrides the persisted token file                                                                                                                                                                                                                                                                                                |
| `DEVHUB_MCP_HTTP_TOKEN_FILE`    | Where the HTTP MCP token persists (default `~/.config/devhub/mcp-http-token`)                                                                                                                                                                                                                                                                                                         |
| `DEVHUB_MCP_HTTP_ALLOWED_HOSTS` | Extra Host/Origin values the HTTP MCP entry accepts besides loopback (comma-separated) — needed for tunnelled remote clients                                                                                                                                                                                                                                                          |
| `DEVHUB_MCP_TOOLSETS`           | Comma-separated toolset allowlist for the MCP server (e.g. `notes,tasks,agents,terminal`); unset or `all` registers everything. Cursor ACP sync sets a slimmer default on `devhub` — keep `mcp/shared/devhub.json` unset so Claude Code stays full.                                                                                                                                                                                                                                                        |
| `DEVHUB_MCP_HISTORY_DAYS`       | How many days of MCP call history to keep (default `30`)                                                                                                                                                                                                                                                                                                                              |
| `DEVHUB_MCP_UI`                 | Set to `1` to attach rendered HTML widgets alongside text in UI-seam tool results (off by default)                                                                                                                                                                                                                                                                                    |
| `DEVHUB_BIND_HOST` | Checkout dashboard bind address (`127.0.0.1` by default). `0.0.0.0` binds all interfaces; the packaged sidecar always binds to loopback. |
| `DEVHUB_CONTENT_ROOT`          | Content base for a private checkout connected through desktop setup. App config and bundled resources keep their separate roots. Set by the private-repo wizard; unset defaults to app-data. |
| `DEVHUB_BASE_URL`              | Pins the dashboard used by dashboard-backed MCP tools. Leave unset: the MCP server follows the primary dashboard advertised in `~/.config/devhub/dashboard.json` and falls back to `http://localhost:1337`. |
| `DEVHUB_SCHEDULER` | `0` disables this process's primary-instance background work, including [scheduled jobs](../guides/scheduled-jobs.md), review/task pollers, share expiry and shared dashboard discovery. Unsupervised checkout dev defaults to `0`; use `1` for standalone work only when no other instance owns them. |
| `DEVHUB_API_SECRET`            | Optional shared secret for mutating dashboard API routes (global `proxy.ts` guard) and sensitive GET routes that call `requireDashboardAuth` (OpenCode recap, agent usage, Paseo routes, every `/api/db` route). Accepts a matching `X-DevHub-Secret` as an alternative to a desktop session token or strict same-origin `Origin`. Sensitive GET/HEAD routes also accept a same-origin `Referer`. Setting a secret doesn't disable those alternatives or add a user login. MCP sends a matching `Origin` and can also send the secret. Generate with `openssl rand -hex 32`. |
| `DEVHUB_GITHUB_OAUTH_CLIENT_ID` | Optional GitHub OAuth app client id for `/setup` device-flow login. Default is the GitHub CLI's public app (`178c6fc778ccc68e1d6a`) so `gh auth login --with-token` accepts the result. Device flow has no client secret. |

## Google Calendar

| Variable                    | Purpose                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`          | OAuth client ID                                                                                                                                         |
| `GOOGLE_CLIENT_SECRET`      | OAuth client secret                                                                                                                                     |
| `GOOGLE_REFRESH_TOKEN`      | Refresh token after sign-in                                                                                                                             |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional OAuth callback override. When unset, DevHub derives the redirect URI from the dashboard origin during sign-in and persists it to `.env.local`. |

## Jira

| Variable                  | Purpose                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `JIRA_DOMAIN`             | Atlassian Cloud domain                                                                                 |
| `JIRA_EMAIL`              | Jira account email                                                                                     |
| `JIRA_API_TOKEN`          | Jira API token                                                                                         |
| `JIRA_DEFAULT_PROJECT`    | Default project key for task-to-Jira creation when the task has no linked parent (defaults to `ABC` in code) |
| `NEXT_PUBLIC_JIRA_DOMAIN` | Browser-visible Jira domain for links                                                                  |

## Datadog

| Variable                     | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATADOG_API_KEY`            | Enables Datadog integration features                                                                     |
| `DATADOG_APPLICATION_KEY`    | Enables Events search, On-Call API, and recent-alerts panels                                             |
| `DD_SITE`                    | Datadog site, such as `datadoghq.com`                                                                    |
| `DATADOG_APP_ORIGIN`         | Full Datadog origin override                                                                             |
| `DATADOG_LINK_ONCALL`        | Custom on-call monitor link                                                                              |
| `DATADOG_LINK_TEAM_ALERTS`   | Custom team alerts link                                                                                  |
| `DATADOG_LINK_EVENTS_TODAY`  | Custom today's events link                                                                               |
| `DATADOG_USER_EMAIL`         | Work email matched against the Datadog on-call roster |
| `DATADOG_ONCALL_SCHEDULE_ID` | Optional comma-separated on-call schedule IDs; when unset, DevHub auto-discovers schedules (up to 100)   |

See [Datadog integration](../integrations/datadog.md) for on-call behavior and API routes.

`DATADOG_APPLICATION_KEY` is the canonical name; `DD_APPLICATION_KEY` and `DATADOG_APP_KEY` are accepted aliases in code.

## Infrastructure presence (optional)

`GET /api/setup/status` returns an `infra` gate from `lib/infrastructure-presence.ts`. Enabled plugins may declare `navGate: "infra"`; their own pages and routes remain plugin-owned.

| Variable | Purpose |
| --- | --- |
| `AWS_PROFILE` | Preferred AWS CLI profile for infrastructure views |
| `AUTOMATION_REPO_PATH` | Optional local automation checkout |

Either value, a profile in `~/.aws/config` or `~/.aws/credentials`, or an enabled plugin declaring the gate makes `infra: true`. Configure these in `apps/ui/.env.local` or via 1Password when `DEVHUB_OP_SYNC_LOCAL=1`. Datadog identity is independent and uses `DATADOG_USER_EMAIL`.

## Sharing (one-time links)

| Variable         | Default                  | Purpose                                                                                                                                          |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRIVATEBIN_URL` | `https://privatebin.net` | PrivateBin instance for **One-time** shares (`POST /api/share/one-time`). Content is encrypted client-side before upload; this only picks which server stores ciphertext. Trailing slashes are stripped. Set in `apps/ui/.env.local` — not on `/setup`. |

See [Sharing notes and docs](../guides/sharing.md) for gist vs one-time behaviour, the `#-` URL form (link-scanner safe), and rate-limit troubleshooting.

## Notes and Repo Learning AI (Optional)

These variables configure the HTTP AI provider in `apps/ui/lib/ai/provider.ts`. BlockNote's in-editor AI uses it directly. Repo Learning can instead use a local CLI selected under **Setup → AI Provider**.

Set `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` in `apps/ui/.env.local` for HTTP mode. OpenAI endpoints use the OpenAI SDK adapter; other endpoints use the OpenAI-compatible adapter.

| Variable            | Required | Default                                                  | Purpose                                                       |
| ------------------- | -------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `AI_API_KEY`        | Yes      | —                                                        | Bearer token for your provider                                |
| `AI_BASE_URL`       | No       | `https://api.z.ai/api/coding/paas/v4`                    | OpenAI-compatible API base (no trailing slash)                |
| `AI_MODEL`            | No       | `glm-5-turbo`                                            | Model id sent in chat completion requests                     |
| `AI_REASONING_EFFORT` | No       | `low` for `gpt-*-luna` on OpenAI; otherwise unset        | OpenAI `reasoning.effort`. Invalid values are ignored         |

The GLM-specific `thinking` request option is only sent when `AI_BASE_URL`/`AI_MODEL` point at a z.ai GLM model, so other providers (OpenAI, etc.) aren't sent fields they'd reject.

Reasoning effort is resolved in one place and only sent to `api.openai.com`: a per-call override (such as `JIRA_DRAFT_REASONING_EFFORT`), then `AI_REASONING_EFFORT`, then the model default. `gpt-*-luna` defaults to `low`. Every other model sends nothing and keeps the provider's own default. Accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`.

For OpenAI chat, set `AI_BASE_URL=https://api.openai.com/v1` and `AI_MODEL=gpt-6-luna`.

Copy the commented block from `apps/ui/.env.example` into `.env.local`, set `AI_API_KEY`, and restart the dev server.

### Generate Jira ticket overrides

**Generate Jira ticket** uses the provider chosen under **Setup → AI Provider** unless these are set. They affect that one action only.

| Variable                      | Default | Purpose |
| ----------------------------- | ------- | ------- |
| `JIRA_DRAFT_PROVIDER`         | —       | Provider for drafts: `api` (HTTP, uses `AI_API_KEY` / `AI_BASE_URL`), `cursor`, `codex`, `opencode`, `antigravity` |
| `JIRA_DRAFT_MODEL`            | —       | Model id for drafts (for `api`, an id your `AI_BASE_URL` serves) |
| `JIRA_DRAFT_REASONING_EFFORT` | —       | Overrides `AI_REASONING_EFFORT` for drafts. OpenAI endpoints only: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. An invalid value is ignored |

A CLI agent can take 30–60 seconds per draft. `gpt-6-luna` on the HTTP API uses reasoning effort `low` by default and usually answers in a few seconds. In a packaged app, put these in the env file the app reads (the linked checkout's `apps/ui/.env.local`, or `config/.env.local` in the app data folder) and restart DevHub.

Without an HTTP key, notes still work but in-editor AI is unavailable. Repo Learning can use a configured CLI. Without an AI provider, deterministic repo facts still load.

## Skills (ai-tools merge)

Used when syncing skills from an optional local `ai-tools` checkout. The checkout is a
read-only upstream/shared-team source; DevHub's own `skills/shared/` catalog still wins on
name collisions. See [Sync Engine](../architecture/sync-engine.md) and
[Skills](../guides/skills.md).

| Variable                   | Default                | Purpose                                                 |
| -------------------------- | ---------------------- | ------------------------------------------------------- |
| `AI_TOOLS_ROOT`            | `~/Developer/ai-tools` | Path to local ai-tools clone                            |
| `AI_TOOLS_SYNC`            | `1` (enabled)          | Set to `0` to sync DevHub `skills/shared/` only         |
| `AI_TOOLS_REFRESH_ON_SYNC` | `1` (enabled)          | Set to `0` to skip upstream fetch during sync (offline) |
| `AI_TOOLS_BRANCH`          | repo default via `gh`  | Branch for upstream skills cache                        |
| `DEVHUB_SKILL_SYNC_EXCLUDE_TOOLS` | — | Comma-separated all-target skill-sync destinations to skip (for example, `agents`). Explicit `sync_skills --tool agents` still works. |

Requires `gh auth login` when upstream refresh is enabled.

## Capability Radar

| Variable                   | Default | Purpose                                                                                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPABILITY_AUTHOR_EMAILS` | —       | Comma-separated git author emails for personal exposure scoring. When unset, each scanned repo falls back to `git config user.email`. Multiple values are OR-matched in `git log --author`. |

### Plugins

Plugins (separate repos contributing skills/agents/MCP) are not configured via env vars.
They are listed in a machine-local registry at `~/.config/devhub/plugins.json` and merged
at sync time. See [Plugins](../architecture/plugins.md).

## Terminal, Agent CLI And OpenCode

See [Terminal and agent CLI](../guides/terminal-and-agent-cli.md). Coding chats are on `/agents` ([Paseo](../guides/paseo-agents.md)). DevHub no longer starts OpenChamber.

| Variable                                | Default                         | Purpose                                                                                                                                                                        |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENCODE_SERVER_PASSWORD`              | —                               | When set, DevHub sends Basic auth (`opencode:<password>`) to the lazy OpenCode server used by session recap. |
| `TERMINAL_PORT` | `1439` unsupervised checkout; `1339` otherwise | In-app terminal PTY WebSocket peer (`apps/core/src/local/terminal/server.ts`); localhost-only. |
| `NEXT_PUBLIC_TERMINAL_PORT` | Runtime port, or `1339` fallback | Browser-visible terminal port override; when unset, the dock discovers the running dashboard's terminal port. |
| `DEVHUB_DEVELOPER_DIR`                  | `~/Developer`                   | Default shell cwd for the in-app terminal when a session does not pass `cwd`                                                                                                   |
| `DEVHUB_TERMINAL_ARGS`                  | `-l` (login shell)              | Override shell args when interactive rc files deadlock in the embedded PTY (e.g. `-f` for zsh)                                                                                 |
| `DEVHUB_TERMINAL_SHELL`                 | `$SHELL`                        | Override the shell binary for the terminal peer                                                                                                                                |
| `DEVHUB_TERMINAL_LOG_DIR`               | `<tmpdir>/devhub-terminal-logs` | Per-session PTY output logs for **Copy all output** (`GET /api/terminal/log`)                                                                                                  |
| `DEVHUB_TERMINAL_PASTE_DIR`             | `<tmpdir>/devhub-terminal-paste` | Where images pasted or dropped into the dock are written; the absolute path is typed at the prompt. |
| `DEVHUB_TERMINAL_SHELL_INTEGRATION`     | on                              | Set `0` to stop injecting OSC 133 prompt marks into zsh. Block cards need them. |
| `DEVHUB_AGENT_CLI`                      | `cursor`                        | Default agent for DevHub launches (auto-review, schedules, `agent_dispatch`) until one is picked on Agents → Connection: a Paseo provider id such as `cursor`, `claude`, `codex` (`chatgpt` works as an alias) or `opencode`. Prefer `DEVHUB_AI_PROVIDER`. Saving a provider from `/setup` writes both. |
| `DEVHUB_AI_PROVIDER`                    | unset (auto)                    | Provider for in-app generation: `cursor-cli`, `chatgpt-cli`, `antigravity-cli`, `opencode`, or `api`. Unset = first available in that order, then `AI_API_KEY`. Configure from `/setup` → AI Provider. |
| `DEVHUB_AI_MAX_CONCURRENT`              | `3`                             | Process-wide cap on concurrent agent CLI / `generateAiText` runs. Extra jobs queue; wait time is **not** counted against a job's timeout. Set `1` on a small machine. |
| `DEVHUB_AGENT_OPENCODE_MODEL`           | —                               | Optional `provider/model` override for OpenCode runs; blank uses the `model` in `opencode.json`                                                                        |
| `DEVHUB_AGENT_CURSOR_MODEL`             | `cursor-grok-4.5-high`          | CLI model id when Cursor is the one-shot provider. Paseo launches map it to Cursor's ACP form (e.g. `grok-4.6[effort=high,fast=true]`) and use `grok-4.6[effort=high]` when unset. |
| `DEVHUB_AGENT_ANTIGRAVITY_MODEL`        | —                               | Optional `agy --model` override when Antigravity CLI is selected                                                                                                                |
| `DEVHUB_OPENCODE_BINARY`                | —                               | Override path to the `opencode` binary                                                                                                                                         |
| `DEVHUB_SIGN_IDENTITY`                  | —                               | Code-signing identity for the desktop scripts. Overrides the local certificate; set this to an Apple Developer ID when you have one. See [macOS permissions](../guides/macos-permissions.md). |

Do not set `OPENCODE_PORT`, `OPENCODE_HOST` or `OPENCODE_SKIP_START`; the recap server picks its own loopback port.

## External Commands And Usage

| Variable               | Default          | Purpose |
| ---------------------- | ---------------- | ------- |
| `DEVHUB_EXEC_TIMEOUT_MS` | `30000`        | Default timeout for `execExternal` calls. Overdue calls show on Status → External commands. |
| `DEVHUB_GH_TIMEOUT_MS` | `30000`          | Default timeout for `gh` calls. |
| `DEVHUB_PROJECTS_FILE` | `~/.config/devhub/projects.json` | Where Repos project groups (`/api/projects`) are stored. |
| `OPENAI_ADMIN_KEY`     | —                | Organisation admin key. Agents → Usage shows billed Codex spend instead of an estimate from local logs. |
| `CODEX_HOME`           | `~/.codex`       | Where Usage reads local Codex session logs. |

## Auto PR Review

Poller defaults until the first save from `/prs`; after that `notes/.config/auto-pr-review.json` wins for enable/always. See [Auto PR review](../guides/auto-pr-review.md).

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DEVHUB_AUTO_PR_REVIEW` | off | `1` enables the weekday poller |
| `DEVHUB_AUTO_PR_REVIEW_ALWAYS` | off | `1` skips the weekday/hours window |
| `DEVHUB_AUTO_PR_REVIEW_INTERVAL_MS` | `900000` (15 min, min 60s) | Poll interval |
| `DEVHUB_AUTO_PR_REVIEW_TZ` | `Europe/London` | Timezone for the hours window |
| `DEVHUB_AUTO_PR_REVIEW_START_HOUR` / `_END_HOUR` | `9` / `18` | Hours window |
| `DEVHUB_AUTO_PR_REVIEW_REPOS` | all | Comma-separated `owner/repo` allowlist |
| `DEVHUB_AUTO_PR_REVIEW_CONCURRENCY` | `2` | Reviews at once (clamped to 1–2) |

## DevHub MCP: Agents, Toolsets, History

The DevHub MCP's `agent_*` tools hand work to the managed **Paseo** daemon (Agents). Each dispatch creates a conversation with **YOLO** permissions and the defaults in [Agents (Paseo)](../guides/paseo-agents.md) (Cursor + Grok unless overridden). No terminal tab opens. Providers include Claude Code, Codex, OpenCode and ACP agents such as Cursor and Copilot. Availability comes from the connected daemon. DevHub injects its MCP server at dispatch; harnesses load the user's remaining MCP configuration.

| Variable                      | Default                                 | Purpose                                                                                                                                                           |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVHUB_AGENT_PROVIDERS_FILE` | `~/.config/devhub/agent-providers.json` | Custom CLI provider file used by leftover `legacy-cli` / interactive wrap code. Live `agent_providers` lists **Paseo providers**, not this file. |
| `DEVHUB_AGENT_RUNS_DIR`       | `<NOTES_DIR>/.config/agent-runs`        | Durable `spec.json`, `status.json` and `events.jsonl` for Paseo agents, leftover CLI runs, and AI generation. Finished history is retained. |
| `DEVHUB_AGENT_MAX_RUNS`       | `6`                                     | Active coding runs allowed at once. Small AI generation calls do not consume these slots, and runs whose Paseo session has ended are finished rather than counted. |
| `DEVHUB_AGENT_MAX_COST_USD`   | `25`                                    | Refuse **new** dispatches once finished runs today have recorded this much USD. `0` disables. Mid-run cost is not enforced. |
| `DEVHUB_AGENT_MAX_TURNS`      | `200`                                   | Default turn cap for leftover CLI runners. Paseo dispatch **rejects** `maxTurns` (`400`) — use the assistant's own controls. `0` disables. |
| `DEVHUB_AGENT_MAX_SECONDS`    | `1800`                                  | Wall-clock kill for leftover CLI runners. Paseo agents are not killed by this cap. `0` disables. |
| `DEVHUB_AGENT_MAX_DEPTH`      | `1`                                     | How deep dispatch may nest. `1` means an agent that was itself dispatched cannot dispatch another. The implement flow's assigned reviewer (`tasks_implement_review`) may start one level deeper; nothing can start under it. |
| `DEVHUB_AGENT_DEFAULT_WORKTREE` | `1`                                   | Isolated git worktree on dispatch unless the caller sets `worktree: false`. `0` restores editing `cwd` by default. |
| `DEVHUB_AGENT_ALLOWED_ROOTS`  | `$HOME`                                 | Colon-separated directories a dispatch `cwd` must sit under (`~` allowed). Unset keeps the historical home-wide rule. |
| `DEVHUB_AGENT_TRUST_ALL`      | unset                                   | Leftover CLI dock-consent bypass. Paseo dispatch does not show a first-run dock chip. |
| `DEVHUB_AGENT_CONSENT_FILE`   | `<app-data>/agent-consent.json`         | Leftover CLI first-run consent store (`0600`). |
| `DEVHUB_TASK_PR_WATCH_INTERVAL_MS` | `600000` (10 min, min 60s) | How often the dashboard checks PRs opened by task-linked agent runs (CI failures, review changes, merges) and drafts tasks from new alerts when enabled. Runs only in the process that owns the scheduler (`DEVHUB_SCHEDULER` ≠ `0`). |
| `DEVHUB_MCP_TOOLSETS`         | all                                     | Comma-separated tool groups the DevHub MCP registers, e.g. `notes,tasks,terminal,agents`. Cursor ACP and Cursor agents in Paseo get a slimmer overlay at sync time; Claude Code stays full unless you set this yourself.         |
| `DEVHUB_MCP_HISTORY`          | on                                      | Set `0` to stop recording DevHub MCP tool calls.                                                                                                                  |
| `DEVHUB_MCP_HISTORY_DIR`      | `~/.local/state/devhub/mcp-history`     | One `YYYY-MM-DD.jsonl` per local day: tool, redacted/clipped args, duration, outcome, client, agent run id. Read with `mcp_history` / `mcp_history_summary`.        |
| `DEVHUB_MCP_HISTORY_DAYS`     | `30`                                    | Day files older than this are deleted when an MCP server starts. `0` keeps everything.                                                                            |
| `DEVHUB_MCP_HTTP`             | on                                      | The dashboard starts the HTTP MCP entry from the linked checkout at boot (skipped without a checkout, workspace dependencies, or when the port is taken). Set `0` to stop that. Log: `~/.local/state/devhub/mcp-http.log`. |
| `DEVHUB_MCP_HTTP_PORT`        | `1340`                                  | Port for the HTTP MCP entry (`npm run mcp:http` in `packages/mcp`), served at `/mcp`.                                                                  |
| `DEVHUB_MCP_HTTP_HOST`        | `127.0.0.1`                             | Bind address for the HTTP MCP entry. Leave it on loopback unless a remote client must reach it.                                                                   |
| `DEVHUB_MCP_HTTP_TOKEN`       | generated                               | Bearer token HTTP MCP clients must send (min 32 chars). Unset: generated once into `DEVHUB_MCP_HTTP_TOKEN_FILE`.                                                   |
| `DEVHUB_MCP_HTTP_TOKEN_FILE`  | `~/.config/devhub/mcp-http-token`       | Where the generated HTTP MCP token is kept (0600).                                                                                                                |
| `DEVHUB_MCP_HTTP_ALLOWED_HOSTS` | —                                     | Extra `Host`/`Origin` names the HTTP MCP entry accepts besides loopback, e.g. a Tailscale hostname.                                                               |

## Paseo runtime

DevHub's agent work runs in [Paseo](../guides/paseo-agents.md). The defaults suit the managed install (`npm run agents:install`).

| Variable                 | Default                     | Purpose                                                                                                                                  |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVHUB_PASEO_URL`       | `ws://127.0.0.1:6767/ws`    | Paseo daemon WebSocket. Loopback only.                                                                                                   |
| `DEVHUB_PASEO_PASSWORD`  | —                           | Daemon password, set as **Agents password** in `/setup`. Required by `npm run agents:install`, which stores it hashed; re-run it after changing the password. Falls back to the legacy `OPENCHAMBER_UI_PASSWORD`. |
| `DEVHUB_PASEO_PORT`      | `6767`                      | Managed Paseo daemon port. |
| `DEVHUB_AGENT_AUTO_UPDATE` | on                        | The dashboard updates the agent CLIs Paseo uses (Claude Code, Codex and so on) at most once a day, and only while no agent is working. Set `0` to turn that off. Results are in the scheduler log. |

## 1Password Fallback (Optional)

Used by `apps/ui/scripts/op-secrets.ts` at dev/start to fill missing secrets into `apps/ui/.env.local`.

| Variable               | Default  | Purpose                                                                                                                                                                                                                     |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVHUB_OP_ITEM`       | `devhub` | 1Password item title to read fields from                                                                                                                                                                                    |
| `DEVHUB_OP_VAULT`      | —        | Vault name when multiple items match the title                                                                                                                                                                              |
| `DEVHUB_OP_REFRESH`    | —        | Set to `1` to force re-fetch (ignores sync marker)                                                                                                                                                                          |
| `DEVHUB_OP_CACHE`      | —        | Set to `0` to load secrets without writing `.env.local`                                                                                                                                                                     |
| `DEVHUB_OP_CACHE_DIR`  | env dir  | Where the `.env.op-synced` marker is written                                                                                                                                                                                |
| `DEVHUB_OP_SYNC_LOCAL` | —        | Set to `1` to also pull **local-only** keys (paths, ports, bind hosts) from 1Password when unset in env. Off by default so a new machine's existing paths are never overwritten. Useful for identical multi-machine setups. |

Requires the `op` CLI installed and signed in. Non-secret keys (paths, bind hosts, ports, `AWS_PROFILE`, URLs/model names, etc.) are never loaded from 1Password unless `DEVHUB_OP_SYNC_LOCAL=1`.

Suggested `devhub` item fields for shared local secrets:

| Field label               | Used by                               |
| ------------------------- | ------------------------------------- |
| `GOOGLE_CLIENT_ID`        | Google Calendar OAuth                 |
| `GOOGLE_CLIENT_SECRET`    | Google Calendar OAuth                 |
| `GOOGLE_REFRESH_TOKEN`    | Google Calendar OAuth                 |
| `JIRA_API_TOKEN`          | Jira integration                      |
| `DATADOG_API_KEY`         | Datadog integration                   |
| `DATADOG_APPLICATION_KEY` | Datadog integration                   |
| `DATADOG_APP_KEY`         | Shell/Datadog alias                   |
| `DD_APPLICATION_KEY`      | Datadog alias                         |
| `AI_API_KEY`              | Notes and Repo Learning AI |
| `OPENAI_API_KEY`          | Shell/OpenCode-compatible tools       |
| `NOTION_API_KEY`          | Shell Notion workflows                |
| `ITERABLE_API_KEY`        | Shell Iterable workflows              |

## Development And CI

Optional overrides for install, verify, and emergency pushes. These are not needed for normal day-to-day use.

| Variable                     | Default | Purpose                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVHUB_SKIP_POSTINSTALL`    | —       | Set to any truthy value to skip `apps/ui/scripts/postinstall.ts` (also skipped when `CI` is set). Postinstall bootstraps `.env.local`, notes archive dirs, and git hooks — use `bash scripts/install.sh` for the full bootstrap when postinstall is disabled. |
| `DEVHUB_SKIP_VERIFY`         | `0`     | Set to `1` to bypass all pre-push checks, including the leak scan. Emergency only — fix and re-run the checks before merging. |
| `DEVHUB_PREPUSH`             | —       | Content sync sets this to `content` to skip checks other than the leak scan when every pushed commit touches only the content folders (same list as `CONTENT_SYNC_PATHS`). |
| `DEVHUB_DIST_DIR` | — | Overrides the Vite build output directory; the default is `apps/ui/dist`. |
| `PLAYWRIGHT_BASE_URL`        | —       | Point `npx playwright test` at an already-running dashboard instead of letting Playwright start its own. |
| `PLAYWRIGHT_PORT`            | `PORT` or `1337` | Port Playwright's own dashboard listens on when `PLAYWRIGHT_BASE_URL` is unset. |
| `PLAYWRIGHT_VIDEO`           | —       | `1` records a video of every Playwright test. |
| `BASE_URL`                   | `http://127.0.0.1:1337` | Dashboard the `apps/ui/scripts/e2e-skills-catalog.mjs` smoke test talks to. |

## Set by DevHub itself

The desktop shell and agent runs set these for the processes they start. You shouldn't need to set
them, but they explain behaviour you'll see in logs and in the code.

| Variable                        | Set by                  | Meaning                                                                                                                                  |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVHUB_DESKTOP`                | Desktop shell           | `1` when the dashboard runs inside the packaged app. Switches config, notes and tasks to the app-data directory.                         |
| `DEVHUB_APP_DATA`               | Desktop shell           | Writable OS app-data root. Packaged defaults: `~/Library/Application Support/DevHub` (macOS), `$XDG_DATA_HOME/devhub` or `~/.local/share/devhub` (Linux), `%APPDATA%\DevHub` (native Windows; the WSL sidecar uses Ubuntu `~/.local/share/devhub`). Checkout `npm run dev` uses the repo root unless this is set. |
| `DEVHUB_RESOURCE_ROOT`          | Desktop shell           | Read-only assets bundled in the app (skills, agents, MCP definitions, the default persona, seed docs). Replaced by every update, never written to. |
| `DEVHUB_SERVER_DIR`             | Desktop shell           | The staged server bundle. Agent runs use it to find the bundled agent runner (`services/agent-run.cjs`).                                  |
| `DEVHUB_ENV_FILE`               | Desktop shell           | Absolute path of the user config file. Defaults to `<app-data>/config/.env.local` when packaged and `apps/ui/.env.local` in a checkout.  |
| `DEVHUB_MIRROR_ENV_FILE`        | Tests                   | Overrides where Setup mirrors saved keys for the packaged app. Under Vitest the real Application Support file is never touched.           |
| `DEVHUB_BOOTSTRAP_TOKEN`        | Desktop shell           | Per-launch secret that lets the shell's webview and health probe authenticate. Absent outside the desktop app.                            |
| `DEVHUB_PACKAGED_RUNTIME`       | Desktop sidecar         | `1` in an installed `.app` bundle, as opposed to a checkout attached to the shell.                                                       |
| `DEVHUB_SHELL_SUPERVISED`       | Desktop shell           | `1` when the shell owns the dashboard process. **Rebuild & restart** is disabled in that case; use the shell's menu instead.              |
| `DEVHUB_VERSION`                | Desktop shell           | App version shown by `GET /api/desktop/health` and the migration check.                                                                  |
| `DEVHUB_AGENT_RUN_ID`           | Agent runner            | Id of the DevHub agent run a process belongs to. The MCP server records it with each tool call in its history.                           |
| `DEVHUB_TERMINAL_SESSION_ID`    | Terminal peer           | Id of the dock terminal session, so an agent run can link back to the terminal that started it.                                          |
| `DEVHUB_MCP_HTTP_PARENT_PID`    | Dashboard               | Process id of the dashboard that started the HTTP MCP entry. The MCP process exits when that dashboard is gone, so a stale server never keeps the port. |

## Secret Handling

Do not commit real secrets. Use local environment files, shell environment variables, or a secret manager.

Shared config should refer to secrets by environment variable name rather than containing secret values.

If a key is ever pasted into chat, logs, or a screenshot, rotate it in the provider console and update `apps/ui/.env.local` only.
