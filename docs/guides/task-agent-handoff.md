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
---

# Task agent handoff

Durable link between a DevHub task and one or more agent runs, plus markdown a later session reads before continuing.

## Why

`Implement with Agent…` can pause mid-task (EOD, blocked, abandon). Chat scrollback is not a contract. The sidecar stores run ids/status and a **handoff** the `devhub-implement-task` skill writes before stopping and reads first on resume.

## Storage

- `notes/.config/task-agent-runs/<taskId>.json` — `{ version, taskId, handoff, handoffUpdatedAt?, runs[] }`
- `notes/.config/task-agent-runs/_index.json` — `runId → taskId` for status sync when `/api/agent/runs` updates

Run fields: `runId`, `status` (`queued` | `running` | `paused` | `done` | `failed` | `abandoned`), `provider?`, `startedAt` / `updatedAt`, optional `prUrl` / `branch` / `sessionId` / `terminalSessionId`.

## UI

- **Implement with Agent…** dispatches via `/api/agent/runs` when a checkout is known, then **upserts** the task↔run sidecar (falls back to interactive CLI if dispatch is unavailable).
- Task row **chip**: Running / Paused / Ready to resume — links to `/agent-activity?run=<id>`.
- Context menu **Resume with Agent…** when the latest linked run is `paused`, `abandoned`, `failed`, or interrupted — calls `POST /api/tasks/agent-runs/resume`.

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

# Resume (follow-up preferred, else new run quoting handoff)
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
2. **Repo** — exactly one `kind: "repo"` link, **or** the user picks one in the modal, **or** a hub checkout (`hubRepoId`) when links are empty.
3. **Prerequisites** — no open linked task (outbound or inbound) tagged `#prerequisite`, `#prereq`, or `#blocker`.

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
