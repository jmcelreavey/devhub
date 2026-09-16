---
title: Task agent handoff
description: Durable task↔agent-run records and markdown handoffs for Implement and Resume with Agent.
order: 9
icon: Bot
tags: [workflow, agents, tasks]
related:
  - reference/api-routes
  - architecture/mcp-server
  - guides/auto-pr-review
  - guides/agents
  - guides/plan-loop
---

# Task agent handoff

Durable link between a DevHub task and one or more agent runs, plus markdown a later session reads before continuing.

## Why

`Implement with Agent…` can pause mid-task (EOD, blocked, abandon). Chat scrollback is not a contract. The sidecar stores run ids/status and a **handoff** the `devhub-implement-task` skill writes before stopping and reads first on resume.

## Storage

- `notes/.config/task-agent-runs/<taskId>.json` — `{ version, taskId, handoff, handoffUpdatedAt?, runs[] }`
- `notes/.config/task-agent-runs/_index.json` — `runId → taskId` for status sync when `/api/agent/runs` updates

Run fields: `runId`, `status` (`queued` | `running` | `paused` | `done` | `failed` | `abandoned`), `provider?`, `startedAt` / `updatedAt`, optional `prUrl` / `branch` / `cwd` / `sessionId` / `terminalSessionId`.

PR watcher fields (see [Plan loop](plan-loop.md)): `prState` (`open` | `merged` | `closed`), `prCheckedAt`, `prSeenAt`, `attention` (`{ kind: ci-failing | changes-requested | new-comments, summary, detectedAt, key }`), `attentionHandled`.

`updatedAt` only moves when a record actually changes — reading a finished run must not make it the task's "latest".

**Rollover.** Open tasks get a new id every morning. Rollover moves the sidecar to the new id (`relinkTaskAgentRuns`), so Running / Resume / PR state carry over.

## Automatic handoff snapshot

When a task-linked run ends — CLI exit, `agent_interactive_finish`, cancel, or a closed tab — DevHub appends one entry per run:

```markdown
### Run run-mu43p05l-1ca8a3ee — failed (exit 1) · 2026-09-17 10:02 UTC
- CLI: claude
- Branch: `feat/x` at abc1234 Add x
- Changes vs origin/main: 3 files changed, 20 insertions(+)
- Uncommitted: 2 file(s) — inspect before continuing
- Continue with CLI session `433c5245-…`
```

It also stores `branch` and `cwd` on the run so the PR watcher can find the pull request. Agent-written notes stay above; the snapshot only appends.

## Interactive run lifecycle

Implement, Resume and Write plan all open the CLI interactively in the terminal dock. The tab runs:

```bash
<agent-run> --interactive-start <run-dir> $; <cli …>; __devhub_rc=$?; <agent-run> --interactive-finish <run-dir> "$__devhub_rc"
```

- `--interactive-start` records the tab's shell pid → state `running`. Until then the run is `queued` (never-started runs fail after 16 minutes).
- `--interactive-finish` records the CLI exit: `0` → `succeeded`, `130` (Ctrl+C) → `cancelled`, anything else → `failed`. A run the agent already finished with `agent_interactive_finish` keeps that result.
- Closing the tab kills the shell; the dead-pid reconcile marks the run `cancelled` ("Terminal tab closed before the CLI exited").
- Cancelling an interactive run from Agent Activity closes the record and never signals your shell.

## UI

- **Implement with Agent…** (ready tasks only) opens the chosen CLI interactively in the terminal dock, registers the run in Agent Activity, and links it to the task. "Default" resolves to your configured CLI first, so Activity names the CLI that actually ran.
- The dialog stays on the page; the toast has **View activity**.
- Task row **chip**, most urgent first: Running · CI failing / Changes requested / New PR comments (opens Fix PR) · PR merged · PR closed · PR open · Paused · Continue / Ready to resume · Draft. PR chips open the pull request; the rest open `/agent-activity?run=<id>`.
- **Resume with Agent…** when the latest run is `paused`, `abandoned` or `failed`; **Continue with Agent…** when it is `done` with a CLI session; **Fix PR with Agent…** when the PR needs attention. Picking the prior CLI continues its session; the banner says which will happen.
- Task rows share one poll of `GET /api/tasks/agent-runs/summary` (15s) instead of one request per row.
- The model field remembers the last model per stage (planning vs implementing) and CLI.

## HTTP

```bash
# List
curl -sS -H "Origin: http://127.0.0.1:1400" \
  'http://127.0.0.1:1400/api/tasks/agent-runs?taskId=<TASK_UUID>'

# Link / update a run
curl -sS -X POST -H "Origin: http://127.0.0.1:1400" -H 'content-type: application/json' \
  http://127.0.0.1:1400/api/tasks/agent-runs \
  -d '{"taskId":"<TASK_UUID>","runId":"run-…","status":"running","provider":"claude"}'

# Read / write handoff
curl -sS -H "Origin: http://127.0.0.1:1400" \
  'http://127.0.0.1:1400/api/tasks/agent-runs/handoff?taskId=<TASK_UUID>'
curl -sS -X PUT -H "Origin: http://127.0.0.1:1400" -H 'content-type: application/json' \
  http://127.0.0.1:1400/api/tasks/agent-runs/handoff \
  -d '{"taskId":"<TASK_UUID>","handoff":"## Handoff\n…","mode":"replace"}'

# Resume headlessly (MCP/API). 409 while a run is active; continues the session when
# the provider matches and supports resume; otherwise a new run quoting the handoff.
curl -sS -X POST -H "Origin: http://127.0.0.1:1400" -H 'content-type: application/json' \
  http://127.0.0.1:1400/api/tasks/agent-runs/resume \
  -d '{"taskId":"<TASK_UUID>","date":"YYYY-MM-DD","origin":"http://127.0.0.1:1400"}'
```

When `DEVHUB_API_SECRET` is set, also send `X-DevHub-Secret`.

## MCP

- `tasks_agent_runs` — list (`taskId` only) or upsert (`taskId` + `runId` + fields)
- `tasks_agent_handoff_get` / `tasks_agent_handoff_set`
- `tasks_agent_resume` — same behaviour as the UI Resume action (`POST /api/tasks/agent-runs/resume`)

Manual compose (when you need finer control): `tasks_agent_handoff_get` → `agent_followup` (or `agent_dispatch`) → `tasks_agent_runs` upsert.

## Skill

`skills/shared/devhub-implement-task` §0.5 documents the contract.

## Implement ready

Optional light checklist before **Implement with Agent…** is a good idea — **warn by default**, hard-block only when flipped.

Checks:

1. **Acceptance / plan** — Jira description has content, **or** the task note has a `## Plan` / `## Acceptance` section with real body text (scaffold `- ` alone does not count).
2. **Open questions** — no unchecked lines under `## Open questions` in the task note (`- [x]` counts as answered).
3. **Repo** — exactly one `kind: "repo"` link, **or** the user picks one in the modal, **or** a hub checkout (`hubRepoId`) when links are empty.
4. **Prerequisites** — no open linked task (outbound or inbound) tagged `#prerequisite`, `#prereq`, or `#blocker`.

```bash
curl -sS -H "Origin: http://127.0.0.1:1400" \
  'http://127.0.0.1:1400/api/tasks/implement/ready?taskId=<TASK_UUID>&date=YYYY-MM-DD'
```

Response includes `items[]` (`ok`, `label`, `detail`, optional `fixHref` / `fixLabel`), plus `ok` / `warn` / `blocked` / `hardBlock` / `selectedRepoId`.

Hard-block sources (first match wins for the request):

- Query `hardBlock=1`
- UI checkbox (localStorage `devhub:implement-ready-hard-block`)
- Vault prefs `notes/.config/implement-ready.json` → `{ "version": 1, "prefs": { "hardBlock": true } }`

MCP: `tasks_implement_ready` (`taskId`, optional `date`, `selectedRepoId`, `hubRepoId`, `hardBlock`).
