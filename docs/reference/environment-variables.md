# Environment Variables

DevHub uses local environment variables for paths, ports, integrations, and secrets.

Most values live in the dashboard's local environment file and can be edited from `/setup`.

## Core Variables

| Variable                       | Purpose                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `NOTES_DIR`                    | Directory for notes, learnings, and diagrams                                                                           |
| `DOCS_DIR`                     | Optional override for repo docs (default: `REPO_ROOT/docs`)                                                            |
| `TASKS_DIR`                    | Optional override for daily tasks (default: `REPO_ROOT/tasks`) — point elsewhere to keep personal data out of the tree |
| `COLLECTIONS_DIR`              | Optional override for checklist collections (default: `REPO_ROOT/collections`)                                         |
| `UPSTARTS_DIR`                 | Optional override for per-repo Upstart scripts (default: `REPO_ROOT/upstarts`)                                         |
| `REPO_ROOT`                    | DevHub repository root                                                                                                 |
| `NEXT_PUBLIC_REPO_ROOT`        | Browser-visible mirror of `REPO_ROOT` for client-side terminal commands (PR review notes). Set to the same path as `REPO_ROOT` in `dashboard/.env.local`; not auto-populated by postinstall. Without it, OpenCode PR reviews launched from `/prs` may write notes outside DevHub's `notes/` tree. |
| `PORT`                         | Dashboard port                                                                                                         |
| `DEVHUB_BIND_HOST`             | Dashboard bind address (`0.0.0.0` default). Electron maps `0.0.0.0`, `::`, `auto`, and `lan` to `localhost` for its window URL; LAN clients use the proxy URLs from `/setup` |
| `DEVHUB_BASE_URL`              | Dashboard URL used by dashboard-backed MCP tools. Defaults to `http://localhost:1337`                                  |
| `DEVHUB_API_SECRET`            | Optional shared secret for sensitive dashboard routes (e.g. OpenCode recap). When set, callers must send `X-DevHub-Secret`; when unset, those routes require a strict same-origin `Origin` header (browser-only). Set the same value in the MCP server's env when using `sessions_recap`. Generate with `openssl rand -hex 32`. |
| `DEVHUB_LAN_PROXY_HOST`        | Optional LAN proxy host. Use `auto` to detect a physical LAN IPv4 and exclude Tailscale CGNAT (`100.64.0.0/10`)        |
| `DEVHUB_ALLOWED_DEV_ORIGINS`   | Comma-separated extra `allowedDevOrigins` for `npm run dev` (Next.js 16+). Default allowlist covers common private LAN ranges (`192.168.*.*`, `10.*.*.*`, etc.). Add custom host patterns when opening the dashboard from a phone/tablet at `http://<lan-ip>:1337` and the UI never finishes loading — see [Setup — LAN access](getting-started/setup.md#localhost-vs-lan-access). |
| `OPENCHAMBER_HOST`             | OpenChamber local bind address. LAN access is proxied when enabled                                                     |
| `NEXT_PUBLIC_OPENCHAMBER_PORT` | Browser-visible OpenChamber port                                                                                       |

## Google Calendar

| Variable               | Purpose                     |
| ---------------------- | --------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth client ID             |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret         |
| `GOOGLE_REFRESH_TOKEN` | Refresh token after sign-in |

## Jira

| Variable                  | Purpose                               |
| ------------------------- | ------------------------------------- |
| `JIRA_DOMAIN`             | Atlassian Cloud domain                |
| `JIRA_EMAIL`              | Jira account email                    |
| `JIRA_API_TOKEN`          | Jira API token                        |
| `JIRA_DEFAULT_PROJECT`    | Default project key for **Add to Jira** when the task has no linked parent (defaults to `PTF` in code) |
| `NEXT_PUBLIC_JIRA_DOMAIN` | Browser-visible Jira domain for links |

## Datadog

| Variable                       | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `DATADOG_API_KEY`              | Enables Datadog integration features                                    |
| `DATADOG_APPLICATION_KEY`      | Enables Events search, On-Call API, and recent-alerts panels            |
| `DD_SITE`                      | Datadog site, such as `datadoghq.com`                                   |
| `DATADOG_APP_ORIGIN`           | Full Datadog origin override                                            |
| `DATADOG_LINK_ONCALL`          | Custom on-call monitor link                                             |
| `DATADOG_LINK_TEAM_ALERTS`     | Custom team alerts link                                                 |
| `DATADOG_LINK_EVENTS_TODAY`    | Custom today's events link                                              |
| `BI_OPS_USER_EMAIL`            | Work email matched against the Datadog on-call roster; also gates BI ops nav when set with other BI vars |
| `DATADOG_ONCALL_SCHEDULE_ID`   | Optional comma-separated on-call schedule IDs; when unset, DevHub auto-discovers schedules (up to 100) |

See [Datadog integration](../integrations/datadog.md) for on-call behavior and API routes.

## Notes, Repo Learning, and Briefing AI (Optional)

BlockNote AI in the notes editor, Repo Learning generated artifacts, and morning-briefing enrichment (dev tip, AI summary, interests, and the **Tune briefing** chat) work with any **OpenAI-compatible** chat-completions endpoint — [z.ai](https://z.ai) (the default), OpenAI, OpenRouter, Together, Groq, a local Ollama/LM Studio server, etc. Point `AI_BASE_URL` / `AI_MODEL` at your provider and set `AI_API_KEY`. Configure these in `dashboard/.env.local` only - not on `/setup`.

| Variable      | Required | Default                               | Purpose                                                 |
| ------------- | -------- | ------------------------------------- | ------------------------------------------------------- |
| `AI_API_KEY`  | Yes      | —                                     | Bearer token for your provider                          |
| `AI_BASE_URL` | No       | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible API base (no trailing slash)          |
| `AI_MODEL`    | No       | `glm-5-turbo`                         | Model id sent in chat completion requests               |
| `AI_IMAGE_BASE_URL` | No | mirrors `AI_BASE_URL` when it points at `api.openai.com` | OpenAI-compatible **images** API base for briefing canvas art |
| `AI_IMAGE_MODEL`    | No | `gpt-image-1` when base is OpenAI     | Image model id (`/images/generations`)                  |

The GLM-specific `thinking` request option is only sent when `AI_BASE_URL`/`AI_MODEL` point at a z.ai GLM model, so other providers (OpenAI, etc.) aren't sent fields they'd reject.

For OpenAI chat, set `AI_BASE_URL=https://api.openai.com/v1` and `AI_MODEL=gpt-4o-mini` (or similar). Briefing canvas imagery auto-enables on OpenAI bases; for other image endpoints set `AI_IMAGE_BASE_URL` and `AI_IMAGE_MODEL` explicitly. Generated PNGs cache under `~/.cache/devhub/briefing-images/`.

Copy the commented block from `dashboard/.env.example` into `.env.local`, set `AI_API_KEY`, and restart the dev server.

Without a key, notes still work, Repo Learning still shows deterministic repo facts, and the morning briefing still loads with RSS/weather/event content. Notes AI menu actions, Repo Learning generated features, and briefing chat return HTTP 503 with a short configuration message. Briefing AI sections fall back to deterministic content instead of failing the whole page.

## Last30Days research (optional)

Briefing **interests** and on-demand **research tasks** can pull source-backed digests from the Last30Days skill when its Python script is installed. Without it, background research tasks fall back to an AI-written brief when `AI_API_KEY` is set.

| Variable                   | Default          | Purpose                                                                 |
| -------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `LAST30DAYS_MEMORY_DIR`    | `notes/research` | Where digests are saved. Repo-relative paths resolve from `dashboard/`. |
| `LAST30DAYS_SCRIPT`        | auto-discovered  | Explicit path to `last30days.py`. When unset, DevHub checks `~/.claude/skills/last30days/`, `~/.config/opencode/skills/last30days/`, `~/.opencode/skills/last30days/`, `~/.codex/skills/last30days/`, and `~/.cursor/skills/last30days/`. |
| `LAST30DAYS_SOURCES`       | —                | Comma-separated sources passed to the script as `--search` (e.g. `reddit,hn,github,polymarket,web`). |
| `LAST30DAYS_MAX_AGE_HOURS` | `72`             | Skip re-running Last30Days for an interest when a matching file in the research dir is newer than this. |

The Last30Days script reads its own provider keys from the environment (and from the 1Password `devhub` item when `op` is configured): `XAI_API_KEY`, `XQUIK_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `SCRAPECREATORS_API_KEY`, `BLUESKY_APP_PASSWORD`, and similar. See the commented block in `dashboard/.env.example`.

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

Requires `gh auth login` when upstream refresh is enabled.

### Plugins

Plugins (separate repos contributing skills/agents/MCP) are not configured via env vars.
They are listed in a machine-local registry at `~/.config/devhub/plugins.json` and merged
at sync time. See [Plugins](../architecture/plugins.md).

## OpenCode And OpenChamber

See [OpenCode and OpenChamber](../guides/opencode-and-chamber.md) for how the local peer ports work together.

| Variable                                | Default                 | Purpose                                                                                                                                                             |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCHAMBER_PORT`                      | `1336`                  | OpenChamber daemon port                                                                                                                                             |
| `OPENCHAMBER_HOST`                      | `0.0.0.0`               | OpenChamber bind host                                                                                                                                               |
| `OPENCHAMBER_UI_PASSWORD`               | —                       | UI password required to bind a LAN host on OpenChamber ≥1.13. Configure from `/setup`. Without it (or the override below) DevHub falls back to binding `127.0.0.1`. |
| `OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN` | `false`                 | Set `true` to expose OpenChamber over the LAN without a UI password (not recommended)                                                                               |
| `NEXT_PUBLIC_OPENCHAMBER_PORT`          | `1336`                  | Chamber iframe URL port in the browser                                                                                                                              |
| `OPENCODE_PORT`                         | `1338`                  | Shared `opencode serve` port                                                                                                                                        |
| `OPENCODE_BIND_HOST`                    | `0.0.0.0`               | `opencode serve --hostname`                                                                                                                                         |
| `OPENCODE_SERVER_PASSWORD`            | —                       | When set, DevHub sends Basic auth (`opencode:<password>`) to the local OpenCode API — used by Datadog **Investigate**, PR review handoffs, and other dashboard→OpenCode calls |
| `NEXT_PUBLIC_OPENCODE_PORT`             | `1338`                  | OpenCode iframe URL port in the browser                                                                                                                             |
| `TERMINAL_PORT`                         | `1339`                  | In-app terminal PTY WebSocket peer (`dashboard/scripts/terminal-pty-server.ts`); localhost-only                                                                                     |
| `NEXT_PUBLIC_TERMINAL_PORT`             | `1339`                  | Browser-visible terminal port for the docked terminal iframe                                                                                                        |
| `DEVHUB_DEVELOPER_DIR`                  | `~/Developer`           | Default shell cwd for the in-app terminal when a session does not pass `cwd`                                                                                        |
| `DEVHUB_TERMINAL_ARGS`                  | `-l` (login shell)      | Override shell args when interactive rc files deadlock in the embedded PTY (e.g. `-f` for zsh)                                                                      |
| `DEVHUB_TERMINAL_SHELL`                 | `$SHELL`                | Override the shell binary for the terminal peer                                                                                                                     |
| `DEVHUB_TERMINAL_LOG_DIR`               | `<tmpdir>/devhub-terminal-logs` | Per-session PTY output logs for **Copy all output** (`GET /api/terminal/log`)                                                                                |
| `NEXT_PUBLIC_TERMINAL_SCROLLBACK`       | `50000`                         | Max xterm scrollback lines per terminal session in the browser. The on-disk log (`DEVHUB_TERMINAL_LOG_DIR`) is still the source of truth for **Copy all output** on long runs. |
| `DEVHUB_AGENT_CLI`                      | `opencode`              | CLI for one-shot agent handoffs (PR review, DX audit, labs, upstart): `opencode` or `cursor`. Configure from `/setup` → Agent CLI or Skills → Agent CLI.            |
| `DEVHUB_AGENT_OPENCODE_MODEL`           | —                       | Optional `opencode run --model provider/model` override; blank keeps the shared `opencode.json` default                                                             |
| `DEVHUB_AGENT_CURSOR_MODEL`             | `cursor-grok-4.5-high`  | Model passed to `cursor-agent --model` when the Cursor CLI is selected                                                                                              |
| `DEVHUB_OPENCODE_BINARY`                | —                       | Override path to the `opencode` binary                                                                                                                              |
| `OPENCHAMBER_BIN`                       | —                       | Override path to the `openchamber` CLI. Otherwise DevHub uses `openchamber` on `PATH`; if neither exists the Chamber tab is hidden.                                 |
| `OPENCHAMBER_DATA_DIR`                  | `~/.config/openchamber` | OpenChamber's data dir. DevHub seeds its default theme into `<dir>/settings.json` and copies themes into `<dir>/themes`.                                            |
| `DEVHUB_SKIP_OPENCODE_UPDATE`           | —                       | Set to `1` to skip `opencode upgrade` on peer startup                                                                                                               |

Legacy `OPENCODE_HOST` is treated as a bind host when it is not a URL; prefer `OPENCODE_BIND_HOST`.

## 1Password Fallback (Optional)

Used by `dashboard/scripts/op-secrets.ts` at dev/start to fill missing secrets into `dashboard/.env.local`.

| Variable            | Default  | Purpose                                                 |
| ------------------- | -------- | ------------------------------------------------------- |
| `DEVHUB_OP_ITEM`    | `devhub` | 1Password item title to read fields from                |
| `DEVHUB_OP_VAULT`   | —        | Vault name when multiple items match the title          |
| `DEVHUB_OP_REFRESH` | —        | Set to `1` to force re-fetch (ignores sync marker)      |
| `DEVHUB_OP_CACHE`   | —        | Set to `0` to load secrets without writing `.env.local` |
| `DEVHUB_OP_SYNC_LOCAL` | —     | Set to `1` to also pull **local-only** keys (paths, ports, bind hosts) from 1Password when unset in env. Off by default so a new machine's existing paths are never overwritten. Useful for identical multi-machine setups. |

Requires the `op` CLI installed and signed in. Non-secret keys (paths, bind hosts, ports, `AWS_PROFILE`, URLs/model names, etc.) are never loaded from 1Password unless `DEVHUB_OP_SYNC_LOCAL=1`.

Suggested `devhub` item fields for shared local secrets:

| Field label               | Used by                         |
| ------------------------- | ------------------------------- |
| `GOOGLE_CLIENT_ID`        | Google Calendar OAuth           |
| `GOOGLE_CLIENT_SECRET`    | Google Calendar OAuth           |
| `GOOGLE_REFRESH_TOKEN`    | Google Calendar OAuth           |
| `JIRA_API_TOKEN`          | Jira integration                |
| `DATADOG_API_KEY`         | Datadog integration             |
| `DATADOG_APPLICATION_KEY` | Datadog integration             |
| `DATADOG_APP_KEY`         | Shell/Datadog alias             |
| `DD_APPLICATION_KEY`      | Datadog alias                   |
| `AI_API_KEY`              | Notes, Repo Learning, and briefing AI |
| `OPENAI_API_KEY`          | Shell/OpenCode-compatible tools |
| `NOTION_API_KEY`          | Shell Notion workflows          |
| `ITERABLE_API_KEY`        | Shell Iterable workflows        |

## Development And CI

Optional overrides for install, verify, and emergency pushes. These are not needed for normal day-to-day use.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DEVHUB_SKIP_POSTINSTALL` | — | Set to any truthy value to skip `dashboard/scripts/postinstall.ts` (also skipped when `CI` is set). Postinstall bootstraps `.env.local`, notes archive dirs, git hooks, OpenChamber theme seeding, and plugin branding materialisation — use `bash scripts/install.sh` for the full bootstrap when postinstall is disabled. |
| `DEVHUB_SKIP_NEXT_TYPECHECK` | — | Set to `true` to skip Next.js's build-time TypeScript check. `npm run verify` sets this automatically because `tsc --noEmit` already ran; standalone `npm run build` still typechecks unless you set it. |
| `DEVHUB_SKIP_VERIFY` | `0` | Set to `1` to bypass the `.githooks/pre-push` leak scan and `npm run verify`. Emergency only — fix and re-run verify before merging. |

## Secret Handling

Do not commit real secrets. Use local environment files, shell environment variables, or a secret manager.

Shared config should refer to secrets by environment variable name rather than containing secret values.

If a key is ever pasted into chat, logs, or a screenshot, rotate it in the provider console and update `dashboard/.env.local` only.
