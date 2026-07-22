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

| Tier              | Source Of Truth                                                               | Dashboard Required                | Tool Groups                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem-backed | Local files under configured content dirs                                     | No                                | Notes, docs, tasks, diagrams, appraisal, DX audit                                                                                |
| Dashboard-backed  | DevHub HTTP routes on `DEVHUB_BASE_URL`                                       | Yes                               | Status, briefing, calendar, work/PRs/Jira, assets, search, scripts, repos (list/open/reveal/clone/learn + full git workspace), capability, sessions, Datadog |
| Script-backed     | Local shell scripts under `REPO_ROOT`                                         | No (runs detached)                | `repo_ship`, `repo_ship_status`                                                                                                  |

Filesystem-backed tools call the vault/storage layer directly and work headless.
Dashboard-backed tools proxy through `DashboardClient`, defaulting to
`http://localhost:1337`, because the dashboard owns runtime state such as service
status, script run history, loaded integration secrets, and repo actions.

If a dashboard-backed tool returns `Could not reach the DevHub dashboard`, start the
dashboard with `npm run dev` or set `DEVHUB_BASE_URL` to the port where it is
running.

## Package Layout

`mcp-servers/devhub-server/src/mcp.ts` is a thin registrar (v4.0.0). It wires tool
groups and does not hold business logic.

| Path                                            | Role                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/mcp.ts`                                    | Entry point — creates `McpServer`, calls each `register*Tools`                    |
| `src/context.ts`                                | `createContext()` — reads `NOTES_DIR`, `TASKS_DIR`, `DOCS_DIR`, `DEVHUB_BASE_URL` |
| `src/tools/*.ts`                                | One registrar per tool group (`notes.ts`, `status.ts`, …)                         |
| `src/storage.ts`, `src/task-diagram-storage.ts` | Filesystem-backed vault access                                                    |
| `src/dashboard-client.ts`                       | HTTP proxy for dashboard-backed tools                                             |
| `src/convert.ts`                                | BlockNote ↔ Markdown conversion for notes                                         |

Filesystem tools import from `shared/vault/` via relative paths. Dashboard tools call
matching routes on `DEVHUB_BASE_URL` through `DashboardClient`.

To add a tool group: create `src/tools/<group>.ts` with a `register*Tools(server, ctx)`
function, import it in `mcp.ts`, and add a dashboard API route when the tool is
dashboard-backed. The shared client config stays in `mcp/shared/devhub.json`.

## Tool Inventory

| Group      | Tools                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes      | `notes_list`, `notes_read`, `notes_write`, `notes_write_asset`, `notes_append`, `notes_search`, `notes_delete`, `notes_create_meeting` |
| Docs       | `docs_list`, `docs_read`, `docs_write`, `docs_append`, `docs_search`, `docs_delete`                                                                                 |
| Tasks      | `tasks_list`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_history`                                                                                       |
| Diagrams   | `diagrams_list`, `diagrams_read`, `diagrams_create`, `diagrams_update`, `diagrams_add_note`, `diagrams_delete`, `diagrams_rename`                                   |
| Appraisal  | `appraisal_record`, `appraisal_set_goal`, `appraisal_list_goals`, `appraisal_read`, `appraisal_list`, `appraisal_people`, `appraisal_summarize`, `appraisal_delete` |
| DX audit   | `dx_audit_list`, `dx_audit_read` — reads `reviews/dx-audit-<repo>-<date>` notes written by the `dx-audit` skill                                                     |
| Capability | `capability_radar`, `capability_scan`, `capability_digest`, `capability_get_lab`, `capability_complete_lab`                                                         |
| Ship       | `repo_ship`, `repo_ship_status` — wraps `scripts/devhub-ship.sh` (detached; poll status while pre-push verify runs)                                                 |
| Status     | `status_services`, `status_git`, `status_mcp`, `services_restart`                                                                                                   |
| Briefing   | `briefing_get`                                                                                                                                                      |
| Calendar   | `calendar_week`, `calendar_list`                                                                                                                                    |
| Work       | `prs_list`, `jira_tickets`, `jira_ticket_get`, `standup_markdown`, `tasks_weekly`, `jira_ticket_transition`                                                         |
| Assets     | `assets_list`                                                                                                                                                       |
| Search     | `search`                                                                                                                                                            |
| Scripts    | `scripts_list`, `scripts_run`, `scripts_run_status`, `scripts_history`                                                                                              |
| Repos      | `repos_list`, `repos_open`, `repos_reveal`, `repos_clone`, `repo_learn`, `repos_git_status`, `repos_git_stage`, `repos_git_discard`, `repos_git_stage_hunk`, `repos_git_diff`, `repos_git_stash`, `repos_git_branches`, `repos_git_branch`, `repos_git_commit`, `repos_git_push`, `repos_git_log`, `repos_git_show`, `repos_git_blame`, `repos_git_conflicts` |
| Sessions   | `sessions_recap`                                                                                                                                                    |
| Datadog    | `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate`                                                                                                    |

BI-specific MCP tools are contributed by the private BI plugin as a separate server; they are not part of the core DevHub server.

Dashboard-backed tools that mutate runtime or external state require `confirm: true` (for example `services_restart`, mutating `scripts_run` entries, `repos_git_stage`, `repos_git_commit`, `repos_git_push`, `repos_git_branch`, and `jira_ticket_transition`). Long-running actions return a `runId`; poll the matching status tool, such as `scripts_run_status`, until the run exits. MCP cannot stream the dashboard's live run log.

All `repos_git_*` tools proxy the Repo Git workspace HTTP routes (`/api/repos/<name>/git/*` and `/branches`) — they do not shell out to `git` directly from the MCP process. Start the dashboard before using them.

Sensitive dashboard routes (currently `GET /api/opencode/recap`) use `requireDashboardAuth`. Set `DEVHUB_API_SECRET` in `dashboard/.env.local` and in the synced MCP env when LAN exposure or non-browser callers need access; `DashboardClient` sends `Origin` and `X-DevHub-Secret` automatically.

## Storage Model

The MCP server uses local files, not a database.

| Data      | Format                                  | Directory   |
| --------- | --------------------------------------- | ----------- |
| Notes     | BlockNote JSON                          | `NOTES_DIR` |
| Docs      | Markdown (`.md`)                        | `DOCS_DIR`  |
| Tasks     | JSON files grouped by date              | `TASKS_DIR` |
| Diagrams  | tldraw JSON embedded in note storage    | `NOTES_DIR` |
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

When `DEVHUB_API_SECRET` is set in `dashboard/.env.local`, add the same value to the `env` block in `mcp/shared/devhub.json` (or your personal MCP overlay), then re-run MCP sync so client configs pick it up. `DashboardClient` sends `Origin` and `X-DevHub-Secret` on every dashboard request when the secret is present in the MCP process env.

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

## Common Workflows

### Read or update docs from an agent

1. Use `docs_search` or `docs_list` to find the page.
2. Use `docs_read` to load the current Markdown.
3. Use `docs_write` only after merging your intended change into the full current content.

`docs_write` is a full-file replacement, not a patch API.

### Run a dashboard action

1. Start the dashboard with `npm run dev`.
2. Call `scripts_list` and inspect whether the target action mutates state.
3. Call `scripts_run` with the script id. Add `confirm: true` only after checking the listed effects.
4. Poll `scripts_run_status` with the returned `runId`.

### Check local health from an agent

Use `status_services`, `status_git`, and `status_mcp` when the dashboard is running. These are dashboard-backed because they inspect live process and repo state.

### Recap an OpenCode session

Use `sessions_recap` (or the `devhub-recap` skill) when you need **what happened** in an OpenCode run — commands, MCP calls, file changes, failures — without prompts or reasoning.

1. Start the dashboard and ensure OpenCode is listening on `OPENCODE_PORT`.
2. Call `sessions_recap` with `directory` set to the workspace path. Omit `sessionId` to pick the current busy root, then the latest root in that directory.
3. Pass `includeChildren: true` only when subagent/child sessions matter.
4. On `409`, multiple root sessions are busy — pass an explicit `sessionId`.

The dashboard route redacts secrets (tokens, env values, URL credentials) before returning JSON.

### Commit and push a sibling repo from an agent

1. Start the dashboard with `npm run dev`.
2. `repos_git_status` with `name` (from `repos_list`) to inspect branch, staged/unstaged files, conflicts, and ahead/behind counts. When `name` is the **DevHub checkout**, files under syncable content paths (`notes/`, `tasks/`, `docs/`, `collections/`, `upstarts/`, `diagrams/`, plus env-resolved content dirs) are **omitted** from `files` — use `status_git` or `sync_notes_tasks_push` for those. The payload includes `contentSyncCount` (how many content files were hidden). Sibling repos return every file.
3. `repos_git_diff` to read unified diffs; `repos_git_stage` / `repos_git_discard` / `repos_git_stage_hunk` to shape the index (`confirm: true`).
4. `repos_git_commit` with `message` and `confirm: true` to commit staged changes (optional `amend`).
5. `repos_git_push` with `confirm: true` to push (optional `remote`, `branch`).

For branch checkout, pull, fetch, and undo, use `repos_git_branches` (read) and `repos_git_branch` (mutate). Stash, log, show, blame, and conflict resolution have matching `repos_git_*` tools that proxy the same routes as the Repo Git workspace UI.

Structured errors from the underlying routes: `409 index_lock` (another git process holds `.git/index.lock`), `409 stash_conflict` (unmerged paths after stash apply/pop), `422 hook_failed` (pre-commit/pre-push). Hook failures persist full output under `.git/devhub-hook-failure.log` in the target repo. The UI offers a terminal handoff via the `git-hook-fix` skill.

### Capture appraisal notes from an agent

Appraisal data lives under `notes/appraisal/` as BlockNote JSON. Filesystem-backed tools work without the dashboard.

1. `appraisal_record` — append a moment, win, or feedback entry for a year (self or a person slug).
2. `appraisal_set_goal` / `appraisal_list_goals` — define and review goals for the review period.
3. `appraisal_read` / `appraisal_list` / `appraisal_people` — browse existing entries.
4. `appraisal_summarize` — generate a year-end summary from captured notes and goals.
5. `appraisal_delete` — remove an entry when correcting mistakes.

Storage layout: `notes/appraisal/self/<year>.json` for self-reviews; `notes/appraisal/people/<slug>/<year>.json` for others. See [Notes System — Appraisal](notes-system.md) for vault details.

### Read a DX audit report

The `dx-audit` skill writes reports to `notes/reviews/dx-audit-<repo>-<YYYY-MM-DD>.json`. Agents can list and read them without the dashboard:

1. `dx_audit_list` — optional `repo` filter; newest first.
2. `dx_audit_read` — pass `repo`; optional `date` (`YYYY-MM-DD`) defaults to latest.

### Run Capability Radar from an agent

Capability tools proxy dashboard routes under `/api/capability/*`. Start `npm run dev` first.

1. `capability_scan` — full scan across local repos (optional `includeGithub`, `githubFilter`).
2. `capability_radar` — latest snapshot + diff + drift summary.
3. `capability_digest` — weekly digest; pass `generate: true` to run a fresh scan.
4. `capability_get_lab` — fetch an existing lab by `signalId` (labs are built from the UI or terminal skill).
5. `capability_complete_lab` — mark a lab done and tick its follow-up task.

See [Capability Radar plan](../capability-radar-plan.md) for the full feature map.

### Ship everything to main

`repo_ship` wraps `scripts/devhub-ship.sh`. It previews the actual public patch by default; pass `confirm: true` to allow commits and pushes. Pass `includeUpstream: false` to skip public-core reconciliation and the upstream push (`--no-upstream`). A confirmed run imports newer public-core changes first, commits personal data separately from code, pushes the private mirror, ports only the leak-scanned generic catalog patch to public `main` (no PR), and pushes enabled plugin repos. Confirmed runs start **detached** because pre-push verification takes several minutes; poll `repo_ship_status` until the log shows `SHIP DONE` or `SHIP FAILED`.

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

| Symptom                                 | Check                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard-backed tool cannot connect    | Confirm `npm run dev` is running and `DEVHUB_BASE_URL` matches the dashboard port.                                                          |
| Filesystem tool reads the wrong content | Check `NOTES_DIR`, `TASKS_DIR`, and `DOCS_DIR` in the synced MCP config.                                                                    |
| Work tools return auth/setup errors     | GitHub PR tools need `gh auth login`; Jira and Datadog tools need their integrations configured in `/setup` or env vars.                    |
| `sessions_recap` returns `401` / `403`  | Set `DEVHUB_API_SECRET` in dashboard and MCP env (or call from a same-origin browser tab). Restart the dashboard after changing the secret. |
| `repos_git_*` can't find the repo       | Pass `path` for clones outside the DevHub scan directory, or use `repos_list` names only for siblings under `dirname(REPO_ROOT)`.           |
| MCP client shows an old tool list       | Re-run MCP sync, then restart the AI tool so it reloads server metadata.                                                                    |
| `tsx` is missing for `devhub`           | Run `cd mcp-servers/devhub-server && npm install`.                                                                                          |
| Plugin MCP server fails to start        | Run `npm install` inside the plugin's `mcp-servers/<name>/` package and re-run MCP sync.                                                    |
| A plugin MCP tool is missing            | Check plugin registration in `~/.config/devhub/plugins.json`, then run the sync action so plugin MCP configs are materialized.              |
| Status page says a command is missing   | Bare commands such as `npx`, `tsx`, and `uvx` must resolve on `PATH`; absolute or relative command paths must exist on disk.                |

## Safety Model

The server is scoped to configured local directories plus documented dashboard
routes. It is not a general filesystem API.

Keep secrets out of notes and docs unless you intentionally want them committed in this private mirror. Public/template backports must still respect the personal-data boundary in `CONTRIBUTING.md`. Dashboard integrations may use local secrets from `.env.local` or configured credential stores, but MCP responses should still be treated as local developer data.
