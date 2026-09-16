---
name: devhub-mcp
description: Use DevHub MCP for notes, tasks, diagrams, dashboard operations, and scheduled jobs.
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
`notes_create_meeting` scaffolds `meetings/YYYY-MM-DD-<slug>` (same as the Today strip).
`notes_create_pr` scaffolds `pr-reviews/<repo>-<n>` with PR + repo `## Links` EntityRefs; `notes_write` on `pr-reviews/` upserts the same links.
`notes_write_asset` writes image bytes (jpg, png, gif, webp); reference them as
`![caption](garden/project/assets/photo-1.jpg)`. Toggles: `::toggle <title>` … `::end-toggle`.
`notes_devhub_open` opens an existing note in a new workspace tab when DevHub is running (desktop app or browser dashboard); it fails cleanly instead of pretending when no client is connected. `ui_open` does the same for any internal page (/work, /briefing, /repos/<name>, …).

**Docs** — `docs_*` over the full `docs/` Markdown tree (list/search cover everything,
unlike the filtered notes slice).

**Tasks** — `tasks_list/create/update/delete/history`. Jira keys in text (e.g. `DAD-1234`)
are auto-detected. **Appraisal** —
`appraisal_record/set_goal/list_goals/read/list/people/summarize/delete` for performance
review notes.

**Diagrams** — `diagrams_*` over tldraw JSON. Never hand-write `diagrams_update`
payloads: tldraw snapshots must carry both `store` and `schema`, and `index` must be a
valid fractional-index key (`a0`…`az`, then `b00`), not a counter.

- **Architecture, flow and sequence diagrams → `diagrams_set_graph`.** Describe nodes,
  edges and groups; the tool does layering, text measurement, arrow binding and swimlanes.
  Do not place boxes by hand — you cannot measure rendered text, so hand-picked
  coordinates overlap once the text wraps.
- **Boxes and connectors → `diagrams_add_shape` + `diagrams_add_arrow`.** Shapes are sized
  to their text and return `x/y/w/h`; arrows bind to shape ids and follow them.
- **`diagrams_add_note` is for actual sticky notes** — a comment or TODO on a canvas, not
  the building block of a diagram.
- Keep node labels to a few short lines and edge labels to one or two short words; tldraw
  wraps arrow labels to a fraction of the arrow length and breaks longer text mid-word.
- `diagrams_read` returns a summary with positions, sizes and any overlapping pairs — use
  it to check your work. `raw:true` returns the (large) full JSON.
- `diagrams_repair` recomputes note sizing across all diagrams.

**DX audits** — `dx_audit_list` / `dx_audit_read` over reports the `dx-audit` skill writes
to `reviews/dx-audit-<repo>-<YYYY-MM-DD>`. `dx_audit_read` with just a repo name returns
the latest audit as markdown; run new audits from the Repos page **DX Audit** button.

## Dashboard tools

- **Status** — `status_services`, `status_git`, `status_mcp`; `services_restart` (confirm).
- **Scripts/sync** — `scripts_list`, then `scripts_run` (mutating scripts need `confirm:true`;
  returns a `runId`), `scripts_run_status`, `scripts_history`. MCP can't stream — poll.
- **Briefing/calendar** — `briefing_get`, `calendar_week`, `calendar_list`.
- **Work** — `prs_list`, `prs_open_in_cursor` (stash + `gh pr checkout` + launch Cursor; `confirm`),
  `jira_tickets`, `jira_ticket_get`, `jira_ticket_transition`
  (lists transitions, then applies with `confirm`), `standup_markdown`, `tasks_weekly`.
- **On-call** — `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate`
  (starts an OpenCode investigation session).
- **Repos** — `repos_list`, `repos_open`, `repos_reveal`, `repos_clone`, `repo_learn`.
- **Repo ownership** — `owned_repos`, `repo_owner_brief`, `repo_pr_radar`,
  `repo_who_owns`, `repo_changed_since`, `repo_knowledge_gaps`.
- **Repo git workspace** (proxies `/api/repos/:name/git/*` + branches) —
  `repos_git_status`, `repos_git_stage`, `repos_git_discard`, `repos_git_stage_hunk`,
  `repos_git_diff`, `repos_git_stash`, `repos_git_branches`, `repos_git_branch`
  (checkout/create/delete/fetch/pull/push/undo-commit), `repos_git_commit`,
  `repos_git_push`, `repos_git_log`, `repos_git_show`, `repos_git_blame`,
  `repos_git_conflicts`. Mutating tools need `confirm:true`.
- **Inventory/search** — `assets_list` (agents|skills|mcp|persona), `search` (notes|docs).
- **Agents** — `agent_providers`, `agent_dispatch`, `agent_race`, `agent_runs`, `agent_output`,
  `agent_wait`, `agent_followup`, `agent_cancel`, `agent_diff`, `agent_interactive_note`,
  `agent_interactive_finish`. Hands a task to another agent CLI
  (Claude Code, Cursor, Codex, Gemini, OpenCode, or a custom one from
  `~/.config/devhub/agent-providers.json`). Runs start immediately with approvals disabled in their
  own dock tab the user can watch and stop, and edit `cwd` directly unless `worktree:true` (so
  changes show in the IDE). Write a self-contained prompt; `agent_wait` then `agent_diff`.
  A dispatched agent cannot dispatch further (`DEVHUB_AGENT_MAX_DEPTH`).
- **Plans** — `tasks_capture` (draft task + context snapshot), `tasks_set_stage` (draft ↔ ready; ready runs the
  checklist), `tasks_plan_status` (what needs a fix / is merged / is running / is ready), `tasks_plan_markdown`
  (portable plan), `tasks_pr_watch` (check agent PRs now, or dismiss a PR alert), `tasks_alert_drafts`
  (new on-call alerts → drafts, off by default), `tasks_retro_inputs` (for `devhub-retro`). Loop:
  capture → `devhub-plan-write` → ready → implement → PR watched → complete → retro.
- **Scheduled jobs** — `jobs_list`, `jobs_get`, `jobs_create`, `jobs_update`, `jobs_delete`, `jobs_run`, `jobs_log`.
  **Use these, not your harness's own cron (`CronCreate`, `/loop`, `/schedule`, scheduled tasks, crontab),
  for anything recurring or deferred that involves DevHub.** A job runs an allowlisted script or an agent
  prompt in a repo; it persists in the dashboard, catches up once after sleep, wakes the Mac by default
  (`wake:false` for frequent jobs) and shows on the Actions page. Agent jobs need the user — they confirm in
  chat, or the job waits for **Approve** in DevHub; say so rather than assuming it will run. `jobs_list`
  reports whether the wake helper is installed. For "did it run?" or "why didn't the Mac wake?", read
  `jobs_log` (optionally `job: <id>`) before guessing — it records why each run fired, how it ended, and
  every wake scheduled. MCP cannot approve agent jobs or install the wake helper; point the user to
  Actions → Scheduled Jobs.
- **Terminal** — `terminal_list`, `terminal_propose_run`, `terminal_proposal_status`, `terminal_tail`,
  `terminal_wait_for` (block until output matches a regex instead of polling the tail).
  Prefer a dock tab over the agent/Cursor shell for anything the user should see: the dock is where
  they can watch it, keep it, and kill it. Always use it for upstarts, Expo, `npm run dev` and other
  long-running commands. Every approved proposal opens its own tab, so nothing waits on another
  session — give each repo a distinct `label` so the dock stays readable. The user confirms in the
  dock; poll status, then tail the session. Dock tabs outlive the agent session, so check
  `terminal_list` before proposing — the service may already be up from an earlier one, and a
  second start just races the first for the port.
- **History** (filesystem, no dashboard) — `mcp_history` traces every DevHub MCP call on a day
  (redacted args, duration, outcome, client, dispatching agent run; filter by `tool: "agent_*"`,
  `errorsOnly`, `agentRunId`); `mcp_history_summary` rolls a day up into totals, actions taken and
  failures — use it for end-of-day recaps and standups instead of reconstructing from memory.
  The dashboard's **Agent activity** page (`/agent-activity`) shows the same history plus agent
  runs, and the standup gains an "Agent activity" section from it.
- **Events** — `events_wait` blocks until something happens instead of you polling: `kind: "pr"`
  (`repo`, `number`, `until: checks_done | review | merged_or_closed | any_change`), `script_run` /
  `agent_run` (`runId`), `datadog_alert` / `recall_event` (optional title `match`). Max 300s; call
  again on timeout.
- **Prompts** — every skill in the checkout's `skills/` is also an MCP prompt (Claude Code:
  `/mcp__devhub__<skill>`, optional `task` argument), so users can invoke a skill directly.

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
