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
| `REPO_ROOT`                    | DevHub repository root                                                                                                 |
| `PORT`                         | Dashboard port                                                                                                         |
| `DEVHUB_BIND_HOST`             | Dashboard bind address (`0.0.0.0` default). Electron maps `0.0.0.0`, `::`, `auto`, and `lan` to `localhost` for its window URL; LAN clients use the proxy URLs from `/setup` |
| `DEVHUB_BASE_URL`              | Dashboard URL used by dashboard-backed MCP tools. Defaults to `http://localhost:1337`                                  |
| `DEVHUB_LAN_PROXY_HOST`        | Optional LAN proxy host. Use `auto` to detect a physical LAN IPv4 and exclude Tailscale CGNAT (`100.64.0.0/10`)        |
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
| `NEXT_PUBLIC_JIRA_DOMAIN` | Browser-visible Jira domain for links |

## Datadog

| Variable                    | Purpose                               |
| --------------------------- | ------------------------------------- |
| `DATADOG_API_KEY`           | Enables Datadog integration features  |
| `DATADOG_APPLICATION_KEY`   | Enables event search and counts       |
| `DD_SITE`                   | Datadog site, such as `datadoghq.com` |
| `DATADOG_APP_ORIGIN`        | Full Datadog origin override          |
| `DATADOG_LINK_ONCALL`       | Custom on-call monitor link           |
| `DATADOG_LINK_TEAM_ALERTS`  | Custom team alerts link               |
| `DATADOG_LINK_EVENTS_TODAY` | Custom today's events link            |

## Notes, Repo Learning, and Briefing AI (Optional)

BlockNote AI in the notes editor, Repo Learning generated artifacts, and morning-briefing enrichment (dev tip, AI summary, interests, and the **Tune briefing** chat) work with any **OpenAI-compatible** chat-completions endpoint — [z.ai](https://z.ai) (the default), OpenAI, OpenRouter, Together, Groq, a local Ollama/LM Studio server, etc. Point `AI_BASE_URL` / `AI_MODEL` at your provider and set `AI_API_KEY`. Configure these in `dashboard/.env.local` only - not on `/setup`.

| Variable      | Required | Default                               | Purpose                                                 |
| ------------- | -------- | ------------------------------------- | ------------------------------------------------------- |
| `AI_API_KEY`  | Yes      | —                                     | Bearer token for your provider                          |
| `AI_BASE_URL` | No       | `https://api.z.ai/api/coding/paas/v4` | OpenAI-compatible API base (no trailing slash)          |
| `AI_MODEL`    | No       | `glm-5-turbo`                         | Model id sent in chat completion requests               |

The GLM-specific `thinking` request option is only sent when `AI_BASE_URL`/`AI_MODEL` point at a z.ai GLM model, so other providers (OpenAI, etc.) aren't sent fields they'd reject.

For OpenAI, set `AI_BASE_URL=https://api.openai.com/v1` and `AI_MODEL=gpt-4o-mini` (or similar).

Copy the commented block from `dashboard/.env.example` into `.env.local`, set `AI_API_KEY`, and restart the dev server.

Without a key, notes still work, Repo Learning still shows deterministic repo facts, and the morning briefing still loads with RSS/weather/event content. Notes AI menu actions, Repo Learning generated features, and briefing chat return HTTP 503 with a short configuration message. Briefing AI sections fall back to deterministic content instead of failing the whole page.

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

See [OpenCode and OpenChamber](../guides/opencode-and-chamber.md) for how the three local ports work together.

| Variable                                | Default                 | Purpose                                                                                                                                                             |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCHAMBER_PORT`                      | `1336`                  | OpenChamber daemon port                                                                                                                                             |
| `OPENCHAMBER_HOST`                      | `0.0.0.0`               | OpenChamber bind host                                                                                                                                               |
| `OPENCHAMBER_UI_PASSWORD`               | —                       | UI password required to bind a LAN host on OpenChamber ≥1.13. Configure from `/setup`. Without it (or the override below) DevHub falls back to binding `127.0.0.1`. |
| `OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN` | `false`                 | Set `true` to expose OpenChamber over the LAN without a UI password (not recommended)                                                                               |
| `NEXT_PUBLIC_OPENCHAMBER_PORT`          | `1336`                  | Chamber iframe URL port in the browser                                                                                                                              |
| `OPENCODE_PORT`                         | `1338`                  | Shared `opencode serve` port                                                                                                                                        |
| `OPENCODE_BIND_HOST`                    | `0.0.0.0`               | `opencode serve --hostname`                                                                                                                                         |
| `NEXT_PUBLIC_OPENCODE_PORT`             | `1338`                  | OpenCode iframe URL port in the browser                                                                                                                             |
| `TERMINAL_PORT`                         | `1339`                  | In-app terminal PTY WebSocket peer (`dashboard/scripts/terminal-pty-server.ts`)                                                                                     |
| `NEXT_PUBLIC_TERMINAL_PORT`             | `1339`                  | Browser-visible terminal port for the docked terminal iframe                                                                                                        |
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

Requires the `op` CLI installed and signed in. Non-secret keys (paths, bind hosts, ports, `AWS_PROFILE`, URLs/model names, etc.) are never loaded from 1Password.

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

## Secret Handling

Do not commit real secrets. Use local environment files, shell environment variables, or a secret manager.

Shared config should refer to secrets by environment variable name rather than containing secret values.

If a key is ever pasted into chat, logs, or a screenshot, rotate it in the provider console and update `dashboard/.env.local` only.
