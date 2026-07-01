# MCP Server

DevHub ships a local Model Context Protocol (MCP) server named `devhub`. AI tools
launch it as a stdio process so agents can read/write local DevHub content and call
selected dashboard workflows through one standard interface.

The canonical server lives in `mcp-servers/devhub-server/src/mcp.ts`; the shared
tool config lives in `mcp/shared/devhub.json`. Users normally do not start the
server manually. Claude, Cursor, Codex, OpenCode, or another MCP client starts it
from the synced config when a tool is invoked.

## Architecture

The server has two tool tiers:

| Tier | Source Of Truth | Dashboard Required | Tool Groups |
| ---- | --------------- | ------------------ | ----------- |
| Filesystem-backed | Local files under configured content dirs | No | Notes, docs, tasks, diagrams, appraisal |
| Dashboard-backed | DevHub HTTP routes on `DEVHUB_BASE_URL` | Yes | Status, briefing, calendar, work/PRs/Jira, assets, search, scripts, repos, Datadog |

Filesystem-backed tools call the vault/storage layer directly and work headless.
Dashboard-backed tools proxy through `DashboardClient`, defaulting to
`http://localhost:1337`, because the dashboard owns runtime state such as service
status, script run history, loaded integration secrets, and repo actions.

If a dashboard-backed tool returns `Could not reach the DevHub dashboard`, start the
dashboard with `npm run dev` or set `DEVHUB_BASE_URL` to the port where it is
running.

## Tool Inventory

| Group | Tools |
| ----- | ----- |
| Notes | `notes_list`, `notes_read`, `notes_write`, `notes_write_asset`, `notes_append`, `notes_search`, `notes_delete` |
| Docs | `docs_list`, `docs_read`, `docs_write`, `docs_append`, `docs_search`, `docs_delete` |
| Tasks | `tasks_list`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_history` |
| Diagrams | `diagrams_list`, `diagrams_read`, `diagrams_create`, `diagrams_update`, `diagrams_add_note`, `diagrams_delete`, `diagrams_rename` |
| Appraisal | `appraisal_record`, `appraisal_set_goal`, `appraisal_list_goals`, `appraisal_read`, `appraisal_list`, `appraisal_people`, `appraisal_summarize`, `appraisal_delete` |
| Status | `status_services`, `status_git`, `status_mcp`, `services_restart` |
| Briefing | `briefing_get` |
| Calendar | `calendar_week`, `calendar_list` |
| Work | `prs_list`, `jira_tickets`, `jira_ticket_get`, `standup_markdown`, `tasks_weekly`, `jira_ticket_transition` |
| Assets | `assets_list` |
| Search | `search` |
| Scripts | `scripts_list`, `scripts_run`, `scripts_run_status`, `scripts_history` |
| Repos | `repos_list`, `repos_open`, `repos_clone`, `repo_learn` |
| Datadog | `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate` |

## Storage Model

The MCP server uses local files, not a database.

| Data | Format | Directory |
| ---- | ------ | --------- |
| Notes | BlockNote JSON | `NOTES_DIR` |
| Docs | Markdown (`.md`) | `DOCS_DIR` |
| Tasks | JSON files grouped by date | `TASKS_DIR` |
| Diagrams | tldraw JSON embedded in note storage | `NOTES_DIR` |
| Appraisal | BlockNote JSON under `notes/appraisal/` | `NOTES_DIR` |

The server converts notes between Markdown-like text and BlockNote JSON so AI tools
can read and write notes naturally. Docs are read and written as raw Markdown. Core
vault filesystem logic lives in [`shared/vault/`](../../shared/vault/README.md) and
is shared by the dashboard and MCP server.

The MCP server runs as plain Node. Imports that cross into shared code must use
relative paths; dashboard `@/` aliases are not resolved when tools spawn the server.

## Configuration

The shared config starts the server with `tsx` from the MCP server package:

```json
{
  "command": "REPO_ROOT/mcp-servers/devhub-server/node_modules/.bin/tsx",
  "args": ["REPO_ROOT/mcp-servers/devhub-server/src/mcp.ts"],
  "env": {
    "NOTES_DIR": "REPO_ROOT/notes",
    "TASKS_DIR": "REPO_ROOT/tasks",
    "DOCS_DIR": "REPO_ROOT/docs",
    "DEVHUB_BASE_URL": "http://localhost:1337"
  }
}
```

`REPO_ROOT` is replaced during MCP sync. The dashboard health check and bootstrap
install the `devhub-server` package dependencies if `node_modules` is missing.

Useful commands:

```bash
npm run dev
(cd dashboard && npx tsx scripts/run-action.ts sync)
(cd mcp-servers/devhub-server && npm install)
```

Run `npm run dev` for dashboard-backed tools. Run the sync action after changing MCP
catalog entries so client configs pick up the new command, args, and environment.

## Plugin MCP Servers

Plugins can contribute simple MCP config files under `mcp/` and full stdio MCP
server packages under `mcp-servers/<name>/`. Full server packages are normal Node
packages with their own `package.json` and `node_modules`.

A plugin MCP config can use `PLUGIN_ROOT` when its command or args need to point
back to the plugin checkout:

```json
{
  "command": "PLUGIN_ROOT/mcp-servers/my-plugin-server/node_modules/.bin/tsx",
  "args": ["PLUGIN_ROOT/mcp-servers/my-plugin-server/src/server.ts"]
}
```

During MCP sync, `PLUGIN_ROOT` is replaced with that plugin's registered path.
During bootstrap and `npm run dev`, DevHub installs missing dependencies for enabled
plugin MCP packages. See [Plugin System](plugins.md) and
[Creating a Plugin](../guides/creating-plugins.md) for the plugin-side layout.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Dashboard-backed tool cannot connect | Confirm `npm run dev` is running and `DEVHUB_BASE_URL` matches the dashboard port. |
| Filesystem tool reads the wrong content | Check `NOTES_DIR`, `TASKS_DIR`, and `DOCS_DIR` in the synced MCP config. |
| MCP client shows an old tool list | Re-run MCP sync, then restart the AI tool so it reloads server metadata. |
| `tsx` is missing for `devhub` | Run `cd mcp-servers/devhub-server && npm install`. |
| Plugin MCP server fails to start | Run `npm install` inside the plugin's `mcp-servers/<name>/` package and re-run MCP sync. |
| Status page says a command is missing | Bare commands such as `npx`, `tsx`, and `uvx` must resolve on `PATH`; absolute or relative command paths must exist on disk. |

## Safety Model

The server is scoped to configured local directories plus documented dashboard
routes. It is not a general filesystem API.

Keep secrets out of notes/docs unless you intentionally store them there. Dashboard
integrations may use local secrets from `.env.local` or configured credential
stores, but MCP responses should still be treated as local developer data.
