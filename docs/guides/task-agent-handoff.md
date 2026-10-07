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

**Rollover.** Open tasks keep their ID and original `createdAt`. The daily `tasks/YYYY-MM-DD.json` files are history snapshots: the previous row is marked moved, and today's row keeps the links, timer state, note path, and agent sidecar identity. Running / Resume / PR state therefore stays attached without moving sidecar files each morning.

**Task notes.** `notePath` identifies the companion plan across days. For older tasks without that field, readers follow `rolledFromId` / `rolledFromDate` and reuse the most recent existing note. Older notes remain available as previous notes; their contents and filenames are preserved. The resolved path is saved on the next task write or rollover. No bulk rewrite of historical tasks or notes is required.

**Legacy links.** Old UUIDs still resolve to the latest task snapshot, including prerequisite checks and live checkboxes embedded in notes. `GET /api/tasks?taskId=<id>` returns that current task and its date. Rollover writes today's snapshot before marking its source moved, so a retry can repair an interrupted write without creating another task.

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

It also stores `branch` and `cwd` on the run as context for resuming work. These do not link a PR: the agent must explicitly record its `prUrl` through `tasks_agent_runs`. Clearing or changing that URL clears the old PR state and alerts. Agent-written notes stay above; the snapshot only appends.

## Interactive leftover

Implement, Resume and Write plan now dispatch through Paseo (`POST /api/agent/runs`), not a docked CLI. `POST /api/agent/runs/interactive` still exists for wrap fragments around a shell CLI (`--interactive-start` / `--interactive-finish`); the current UI does not call it.

Cancelling a run from **Agents → Chats** stops the Paseo agent. Isolated worktrees are the default unless the launch set `worktree: false` (planning runs do).

## UI

- **Implement with Agent…** (ready tasks only) opens the Agents handoff sheet, starts a Paseo agent, registers the run on **Agents → Chats**, and links it to the task. "Default" is the Agents default assistant (usually Cursor).
- The dialog stays on the page; the toast has **View activity**.
- Task row **chip**, most urgent first: Running · CI failing / Changes requested / New PR comments (opens Fix PR) · PR merged · PR closed · PR open · Paused · Continue / Ready to resume · Draft. PR chips open the pull request; the rest open `/agents?run=<id>`.
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
- `tasks_implement_review_settings_get` / `tasks_implement_review_settings_set` — which assistant reviews a finished implementation
- `tasks_implement_review` — start that reviewer on an implementation checkout (see [Review with another assistant](#review-with-another-assistant))

Manual compose (when you need finer control): `tasks_agent_handoff_get` → `agent_followup` (or `agent_dispatch`) → `tasks_agent_runs` upsert.

## Skill

`skills/shared/devhub-implement-task` §0.5 documents the contract.

## Review with another assistant

Before an implementing agent asks to commit, it reviews its own diff with the `pr-explain-review` skill and saves the result as a note. By default the agent that wrote the code does that review. You can assign a different assistant and model instead, say Codex reviewing Claude's work.

**Assign it** in the **Implement with Agent…** sheet: **Review with** and **Review model**, under the agent and model you're implementing with. The choice is saved to `notes/.config/implement-review.json` and applies to every implement run that starts afterwards, until you change it. **Same agent (default)** switches it back off. Over MCP it's `tasks_implement_review_settings_get` / `_set`, and `PUT /api/tasks/implement/review-settings` over HTTP.

**What happens.** The plan payload the implementing agent reads first carries `reviewer` (`{ provider, model }`, or `null`). When it's set, the skill's review step calls `tasks_implement_review` instead of reviewing itself:

1. DevHub starts the assigned assistant on the same checkout, read-only, with a fixed prompt: run `pr-explain-review` in local pre-PR mode and save the review at `pr-reviews/<repo>-<branch>`.
2. The implementing agent waits, reads the note, and checks the working tree didn't change.
3. It fixes every must-fix finding, reruns the checks, and records what it did in a `## Resolution` section of the same note.
4. The review note opens in Cursor beside the worktree, and the agent asks before it commits, as always.

**Limits to know about**

- **Read-only is an instruction, not a sandbox.** Reviewers run in the harness's full-auto mode like every other run. The implementing agent compares `git status` before and after and stops if the tree moved.
- **One level of nesting.** `DEVHUB_AGENT_MAX_DEPTH` still stops agents dispatching agents. The assigned reviewer is the single exception: it may start one level below the implementing agent, and a review can't start another review. The exception lives in the review route, not in `agent_dispatch`.
- **It doesn't block.** If the reviewer can't start (provider not ready, Paseo down), the implementing agent says so, reviews its own diff, and notes that the assigned reviewer didn't run.
- **The review run isn't linked to the task.** The task chip and Resume follow the implementation run. Find the reviewer on **Agents → Chats**.

HTTP: `POST /api/tasks/implement/review` with `{ taskId, date, cwd, notePath, branch?, base? }`. See [API routes](../reference/api-routes.md).

## Implement ready

Optional light checklist before **Implement with Agent…** is a good idea — **warn by default**, hard-block only when flipped.

Checks:

1. **Acceptance / plan** — Jira description has content, **or** the task note has a `## Plan` / `## Acceptance` section with real body text (scaffold `- ` alone does not count).
2. **Open questions** — no unchecked lines under `## Open questions` in the task note (`- [x]` counts as answered).
3. **Repo** — at least one `kind: "repo"` link (or a hub checkout when links are empty). Several links stay on the task; **Add repo** is additive. If more than one is linked, pick which checkout to start in (`selectedRepoId`) — the others are not dropped.
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
