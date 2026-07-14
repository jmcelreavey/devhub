---
name: devhub-mcp
description: "Use the DevHub MCP (stdio server `mcp-servers/devhub-server`). Covers filesystem tools — BlockNote JSON notes under notes/, Markdown docs under docs/, daily tasks, tldraw diagrams, self-appraisal, DX audit reports — AND dashboard-backed tools that proxy the local DevHub dashboard (status, scripts/sync, briefing, calendar, work/PRs, repos, search). Keywords: devhub MCP, notes_list, notes_search, docs_read, tasks_create, scripts_run, status_services, briefing_get, prs_list, jira_tickets, repos_list, dx_audit_list, dx_audit_read."
---

DevHub ships a **stdio MCP server** at `mcp-servers/devhub-server`, wired from
`mcp/shared/devhub.json`. The dashboard's sync/bootstrap substitutes `REPO_ROOT` and writes
per-tool configs. `NOTES_DIR`/`TASKS_DIR`/`DOCS_DIR` default under `REPO_ROOT`, and
`DEVHUB_BASE_URL` defaults to `http://localhost:1337`.

BI-specific tools (AWS profile, CAPI, jumpbox, RDS/Mongo/EKS, IAM) live in a **separate**
server contributed by the `bi` plugin — see the `devhub-bi-mcp` skill.

## Two tiers of tools

1. **Filesystem-backed** (work headless, no dashboard needed) — notes, docs, tasks,
   diagrams, appraisal. These talk straight to disk.
2. **Dashboard-backed** (proxy `http://localhost:1337`; need the dashboard running) —
   status, scripts/sync, briefing, calendar, work/PRs, repos, search. If the dashboard is
   down they return a clear "start it with `npm run dev`" error — that's expected, not a
   bug. Start the dashboard and retry.

Do **not** paste full tool schemas here — they drift. Prefer invoking tools and reading
errors. Tool **descriptions** are the source of truth for args; this skill carries behavior.

## Filesystem tools

**Notes** — default agent surface for `notes_list` / `notes_search` is the workspace slice:
`daily/` dated journals (`daily/YYYY-MM-DD`) plus root-level `*.json` scratch. Other trees
(e.g. `learnings/engineering`) are intentionally out of list/search but reachable via
`notes_read`/`notes_write`/`notes_append`/`notes_delete` with an explicit path.
`notes_write_asset` writes image bytes (jpg, png, gif, webp); reference them as
`![caption](garden/project/assets/photo-1.jpg)`. Toggles: `::toggle <title>` … `::end-toggle`.

**Docs** — `docs_*` over the full `docs/` Markdown tree (list/search cover everything,
unlike the filtered notes slice).

**Tasks** — `tasks_list/create/update/delete/history`. Jira keys in text (e.g. `DAD-1234`)
are auto-detected. **Diagrams** — `diagrams_*` over tldraw JSON; prefer
`diagrams_create`/`diagrams_add_note` over hand-written `diagrams_update` payloads, because
tldraw snapshots must include both `store` and `schema`. **Appraisal** —
`appraisal_record/set_goal/list_goals/read/list/people/summarize/delete` for performance
review notes.

**DX audits** — `dx_audit_list` / `dx_audit_read` over reports the `dx-audit` skill writes
to `reviews/dx-audit-<repo>-<YYYY-MM-DD>`. `dx_audit_read` with just a repo name returns
the latest audit as markdown; run new audits from the Repos page **DX Audit** button.

## Dashboard tools

- **Status** — `status_services`, `status_git`, `status_mcp`; `services_restart` (confirm).
- **Scripts/sync** — `scripts_list`, then `scripts_run` (mutating scripts need `confirm:true`;
  returns a `runId`), `scripts_run_status`, `scripts_history`. MCP can't stream — poll.
- **Briefing/calendar** — `briefing_get`, `calendar_week`, `calendar_list`.
- **Work** — `prs_list`, `jira_tickets`, `jira_ticket_get`, `jira_ticket_transition`
  (lists transitions, then applies with `confirm`), `standup_markdown`, `tasks_weekly`.
- **On-call** — `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate`
  (starts an OpenCode investigation session).
- **Repos** — `repos_list`, `repos_open`, `repos_clone`, `repo_learn`.
- **Inventory/search** — `assets_list` (agents|skills|mcp|persona), `search` (notes|docs).

**Confirmation contract:** any tool that mutates state (a mutating script, a service
restart, a Jira transition) takes `confirm: true`. Without it the tool explains the effect
and stops. **Run polling:** start an action → get a `runId` → poll the matching `*_status`.

## Practices

- Prefer **relative paths** as documented on each tool (`daily/2026-05-11`, `learnings/foo`,
  `architecture/notes-system`).
- `notes_write`/`docs_write` are full replacements — reread and merge before a targeted edit.
- For surgical edits to a structured BlockNote note, verify the backing JSON under
  `REPO_ROOT/notes/<path>.json`; rendered `notes_read` output confirms text exists but not
  exact block placement.
- If MCP tools aren't in the session, fall back to the dashboard/API/fs per task — this
  skill documents a configured MCP, it doesn't replace one.
