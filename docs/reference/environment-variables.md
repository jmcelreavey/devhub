# Environment Variables

DevHub uses local environment variables for paths, ports, integrations, and secrets.

Most values live in the dashboard's local environment file and can be edited from `/setup`.

## Core Variables

| Variable                       | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `NOTES_DIR`                    | Directory for notes, learnings, and diagrams                |
| `DOCS_DIR`                     | Optional override for repo docs (default: `REPO_ROOT/docs`) |
| `TASKS_DIR`                    | Optional override for daily tasks (default: `REPO_ROOT/tasks`) — point elsewhere to keep personal data out of the tree |
| `COLLECTIONS_DIR`             | Optional override for checklist collections (default: `REPO_ROOT/collections`) |
| `REPO_ROOT`                    | DevHub repository root                                      |
| `PORT`                         | Dashboard port                                              |
| `DEVHUB_BIND_HOST`             | Dashboard bind address                                      |
| `OPENCHAMBER_HOST`             | OpenChamber bind address                                    |
| `NEXT_PUBLIC_OPENCHAMBER_PORT` | Browser-visible OpenChamber port                            |

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

## Notes In-Editor AI (Optional)

BlockNote AI in the notes editor calls `POST /api/notes/ai/chat`, which streams through the [z.ai](https://z.ai) OpenAI-compatible **Coding plan** API. Configure in `dashboard/.env.local` only — not on `/setup`.

| Variable        | Required | Default                               | Purpose                                   |
| --------------- | -------- | ------------------------------------- | ----------------------------------------- |
| `Z_AI_API_KEY`  | Yes      | —                                     | Bearer token from z.ai                    |
| `Z_AI_BASE_URL` | No       | `https://api.z.ai/api/coding/paas/v4` | Coding plan API base (no trailing slash)  |
| `Z_AI_MODEL`    | No       | `glm-5-turbo`                         | Model id sent in chat completion requests |

Copy the commented block from `dashboard/.env.example` into `.env.local`, set `Z_AI_API_KEY`, and restart the dev server. Without a key, the editor still works; AI menu actions return HTTP 503 with a short configuration message.

## Skills (ai-tools merge)

Used when syncing skills from the optional `ai-tools` checkout. See [Sync Engine](../architecture/sync-engine.md) and [Skills](../guides/skills.md).

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

| Variable                       | Default   | Purpose                                 |
| ------------------------------ | --------- | --------------------------------------- |
| `OPENCHAMBER_PORT`             | `1336`    | OpenChamber daemon port                 |
| `OPENCHAMBER_HOST`             | `0.0.0.0` | OpenChamber bind host                   |
| `NEXT_PUBLIC_OPENCHAMBER_PORT` | `1336`    | Chamber iframe URL port in the browser  |
| `OPENCODE_PORT`                | `1338`    | Shared `opencode serve` port            |
| `OPENCODE_BIND_HOST`           | `0.0.0.0` | `opencode serve --hostname`             |
| `NEXT_PUBLIC_OPENCODE_PORT`    | `1338`    | OpenCode iframe URL port in the browser |
| `DEVHUB_OPENCODE_BINARY`       | —         | Override path to the `opencode` binary  |
| `OPENCHAMBER_BIN`              | —         | Override path to the `openchamber` CLI  |
| `DEVHUB_SKIP_OPENCODE_UPDATE`  | —         | Set to `1` to skip `opencode upgrade` on peer startup |
| `DEVHUB_SKIP_CHAMBER_UPDATE`   | —         | Set to `1` to skip the OpenChamber npm refresh on peer startup |

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
| `Z_AI_API_KEY`            | Notes in-editor AI              |
| `OPENAI_API_KEY`          | Shell/OpenCode-compatible tools |
| `NOTION_API_KEY`          | Shell Notion workflows          |
| `ITERABLE_API_KEY`        | Shell Iterable workflows        |

## Secret Handling

Do not commit real secrets. Use local environment files, shell environment variables, or a secret manager.

Shared config should refer to secrets by environment variable name rather than containing secret values.

If a key is ever pasted into chat, logs, or a screenshot, rotate it in the provider console and update `dashboard/.env.local` only.
