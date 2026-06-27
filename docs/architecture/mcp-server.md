# MCP Server

DevHub includes a local stdio MCP server so AI tools can work with notes, docs, tasks, diagrams, appraisal notes, and dashboard workflows through one standard interface.

MCP stands for Model Context Protocol. The server lives at `mcp-servers/devhub-server/src/mcp.ts`, is wired by `mcp/shared/devhub.json`, and currently registers as `devhub` version `4.0.0`.

## Tool Tiers

DevHub tools fall into two runtime tiers. This split matters when an AI tool can start the MCP server but the dashboard is not running.

| Tier | Tool Groups | Runtime Requirement |
| ---- | ----------- | ------------------- |
| Filesystem-backed | Notes, docs, tasks, diagrams, appraisal | Work headless. These read and write configured local directories directly. |
| Dashboard-backed | Status, briefing, calendar, work/PRs/Jira, assets, search, scripts, repos, Datadog | Require the dashboard at `DEVHUB_BASE_URL` (default `http://localhost:1337`). |

Dashboard-backed tools return a clean MCP error when the dashboard is unreachable; they do not silently fall back to stale data.

## What The Server Provides

| Tool Group | Example Tools | Capabilities |
| ---------- | ------------- | ------------ |
| Notes | `notes_list`, `notes_read`, `notes_write`, `notes_append`, `notes_search`, `notes_delete`, `notes_write_asset` | Manage BlockNote notes and note assets under `NOTES_DIR`. |
| Docs | `docs_list`, `docs_read`, `docs_write`, `docs_append`, `docs_search`, `docs_delete` | Manage Markdown docs under `DOCS_DIR`. |
| Tasks | `tasks_list`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_history` | Manage daily task JSON files under `TASKS_DIR`. |
| Diagrams | `diagrams_list`, `diagrams_read`, `diagrams_create`, `diagrams_update`, `diagrams_add_note`, `diagrams_delete`, `diagrams_rename` | Manage tldraw diagram notes. |
| Appraisal | `appraisal_record`, `appraisal_set_goal`, `appraisal_list_goals`, `appraisal_read`, `appraisal_list`, `appraisal_people`, `appraisal_summarize`, `appraisal_delete` | Capture performance-review moments and goals in yearly notes under `notes/appraisal/`. |
| Status | `status_services`, `status_git`, `status_mcp`, `services_restart` | Inspect local services, git/content sync state, MCP processes, and restart peer services with confirmation. |
| Briefing | `briefing_get` | Read the dashboard briefing payload. |
| Calendar | `calendar_week`, `calendar_list` | Read configured Google Calendar events through the dashboard. |
| Work | `prs_list`, `jira_tickets`, `jira_ticket_get`, `standup_markdown`, `tasks_weekly`, `jira_ticket_transition` | Query PRs, Jira tickets, standup output, weekly tasks, and transition Jira issues. |
| Assets | `assets_list` | Inventory DevHub-managed agents, skills, MCP servers, and persona targets, including enabled plugins. |
| Search | `search` | Search notes or docs through the dashboard search API, including semantic notes search when configured. |
| Scripts | `scripts_list`, `scripts_run`, `scripts_run_status`, `scripts_history` | Run dashboard-registered scripts and inspect run history. |
| Repos | `repos_list`, `repos_open`, `repos_clone`, `repo_learn` | Manage tracked repos and trigger repo-learning workflows. |
| Datadog | `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate` | Inspect Datadog on-call and alert context when Datadog env vars are configured. |

## Storage Model

Filesystem-backed tools use local files, not a database.

| Data | Default Path | Format |
| ---- | ------------ | ------ |
| Notes | `NOTES_DIR` / `notes/` | BlockNote JSON |
| Docs | `DOCS_DIR` / `docs/` | Markdown (`.md`) |
| Tasks | `TASKS_DIR` / `tasks/` | JSON files grouped by date |
| Diagrams | under `NOTES_DIR` | tldraw JSON |
| Appraisal | `NOTES_DIR/appraisal/` | BlockNote JSON, authored through Markdown conversion |

The server converts notes and appraisal entries between Markdown-like text and BlockNote JSON so AI tools can read and write them naturally. Docs are read and written as raw Markdown. Core vault filesystem logic lives in [`shared/vault/`](../../shared/vault/README.md) and is shared by the dashboard and MCP server.

The MCP server runs as plain Node (stdio). It imports shared packages with **relative paths**, not dashboard `@/` aliases — those aliases are not resolved when tools spawn the server. See the vault README for the import rules dashboard contributors use as well.

## How AI Tools Use It

AI tools launch the MCP server as a local stdio process. The shared MCP config tells each tool how to start it and where the notes, docs, task directories, and dashboard base URL live:

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

Users normally do not need to start the MCP server manually. `install.sh`, bootstrap, and dashboard sync actions materialize per-tool MCP configs from `mcp/shared/devhub.json`.

To run the server directly for troubleshooting:

```bash
cd /path/to/devhub
NOTES_DIR="$PWD/notes" TASKS_DIR="$PWD/tasks" DOCS_DIR="$PWD/docs" \
  DEVHUB_BASE_URL="http://localhost:1337" \
  mcp-servers/devhub-server/node_modules/.bin/tsx mcp-servers/devhub-server/src/mcp.ts
```

If filesystem-backed tools work but dashboard-backed tools fail, start the dashboard with `npm run dev` or set `DEVHUB_BASE_URL` to the dashboard port you are actually using. Yes, this is another local-process dependency; at least it fails loudly.

## Common Uses

- Read today's note.
- Read or search repo docs (architecture, guides, reference).
- Append meeting notes.
- Create or complete a task.
- Search recent daily notes.
- Store a reusable learning.
- Create a tldraw diagram shell.
- Record a self-appraisal moment with references.
- Check local service, git, or MCP status.
- Generate standup markdown from local work context.
- Run a dashboard-registered script and poll its status.

## Safety Model

Filesystem-backed tools are scoped to configured local directories. They should not be treated as a general filesystem API.

Dashboard-backed tools can trigger local actions, including script execution and peer-service restarts. Tools that mutate running services require explicit confirmation where the source handler enforces it, but the dashboard still runs without authentication by default. Keep DevHub on a trusted network and do not expose it to the public internet.

Keep secrets out of notes unless you intentionally store them there. Integration credentials belong in local env files, shell environment variables, or a secret manager.
