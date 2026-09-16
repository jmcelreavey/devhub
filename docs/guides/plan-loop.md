---
title: Plan loop
description: Capture ideas as drafts, write them into plans, hand them to agents, follow the PRs, and learn from what finished.
order: 10
icon: Route
tags: [workflow, agents, tasks]
related:
  - guides/task-agent-handoff
  - guides/auto-pr-review
  - guides/scheduled-jobs
  - reference/api-routes
  - architecture/mcp-server
---

# Plan loop

Every piece of agent work is a DevHub task, and a task moves through one loop:

```
capture → draft ──write plan──▶ ready ──implement──▶ running ──▶ PR ──▶ merged → complete
             ▲                                          │         │
             └────── open questions ◀───────────────────┘   fix PR (CI / review / comments)
                                                                  │
                                                     retro ◀── done / abandoned
```

- **Plans hold the work** — the task note (`## Plan`, `## Acceptance`, `## Open questions`, `## Context snapshot`).
- **Handoffs make any agent replaceable** — every run leaves a snapshot; Resume starts from it.
- **The PR watcher closes the loop** — CI failures and review comments send the agent back; a merge offers to complete the task.
- **The retro rewrites the rules** — it reads what finished and proposes skill changes.

## 1. Capture a draft

Get the thought down before you lose it.

- Work → add task, then **Capture as draft** (the pen icon) or **⇧↵**.
- MCP: `tasks_capture` with `text` and optional `detail` (paste the Slack message or alert).

The task gets `stage: "draft"` and a note with:

- `## Captured` — your detail.
- `## Context snapshot` — related notes, cached PRs, earlier tasks with the same words, and matching Datadog alerts from the last 24h. All best-effort; capture never fails because a source is down.
- `## Open questions` — empty checkbox to fill in.

**From alerts.** Datadog → **Draft a task for new alerts** turns each new firing on-call alert into a draft (`Investigate: <alert>`), once per alert. Off by default; drafts are never dispatched. MCP: `tasks_alert_drafts`.

Draft rows show a dashed **Draft** chip and don't offer **Implement with Agent**.

## 2. Write the plan

Task menu → **Write plan with Agent…** opens a planning run with the `devhub-plan-write` skill. Pick a model that reasons well; the dialog remembers the planning model per CLI separately from the implementing one.

The agent investigates (read-only), writes `## Plan` and `## Acceptance`, lists anything only you can decide under `## Open questions`, and marks the task ready when nothing is left open. Planning runs show in Agent Activity but aren't linked to the task, so Resume stays about the implementation.

## 3. Mark ready

Task menu → **Mark ready for an agent** (MCP `tasks_set_stage`). It runs the implement checklist with hard-block on:

1. Plan or acceptance written (or a Jira description).
2. No unchecked `## Open questions`.
3. Exactly one repo.
4. No open `#prerequisite` / `#blocker` tasks.

Gaps come back as an error toast with **Mark anyway**. **Move back to draft** is there for ready tasks that haven't started.

## 4. Implement

**Implement with Agent…** opens the CLI in the terminal dock and links the run to the task. The dialog has an optional **Anything else the agent should know?** box, which reaches the agent under `## Extra context from me`, and the prompt makes the agent restate the goal, list its assumptions and ask anything open **before** it writes code. That check-in is posted to Agent Activity (`agent_interactive_note`) so the scoping decisions are auditable next to the run. The chip shows **Running** until the CLI exits or the tab closes (see [Task agent handoff](task-agent-handoff.md#interactive-run-lifecycle)). When it ends, a snapshot (branch, commit, changes, session) is appended to the handoff.

## 5. Follow the PR

The dashboard checks the PR of each task's latest finished run every 10 minutes (`DEVHUB_TASK_PR_WATCH_INTERVAL_MS`). It finds the PR from the run's branch if the agent didn't record one.

| What it sees | Task row | Menu |
| --- | --- | --- |
| Failing checks | **CI failing** (red) | **Fix PR with Agent…**, **Dismiss PR alert** |
| Changes requested | **Changes requested** | same |
| New comments from someone else | **New PR comments** | same |
| Open, nothing to do | **PR open** | Continue / Resume |
| Merged | **PR merged** | **Complete task (PR merged)** |
| Closed without merge | **PR closed** | **Abandon task (PR closed)** |

**Fix PR with Agent** is a Resume whose prompt starts with the finding; pick the prior CLI to continue its session. Launching it (or dismissing) marks the finding handled — it won't come back until the PR gets a new commit or a different finding. DevHub never completes or abandons a task on its own.

MCP: `tasks_pr_watch` (`check` / `dismiss`); `tasks_agent_resume` includes the finding and clears it.

## 6. Status

- Today → Morning briefing → **Plans**: what needs you (fix, complete, decide) plus counts of the rest.
- Briefing canvas: `window.__BRIEFING__.planStatus` (live, not day-cached).
- MCP `tasks_plan_status`, HTTP `GET /api/tasks/plan-status`.

Buckets, most urgent first: PR needs a fix · merged (complete it) · PR closed · agent running · waiting on merge · stopped (resumable) · blocked · ready to hand to an agent · drafts to write up.

## 7. Share a plan

Task menu → **Copy plan as markdown**, MCP `tasks_plan_markdown`, or `GET /api/tasks/implement/plan?taskId=&date=&format=markdown`. One file with the task, note, handoff and runs — for a teammate or an agent that can't reach this machine.

## 8. Retro

The `devhub-retro` skill reads `tasks_retro_inputs` (finished and abandoned tasks, run outcomes, PR findings, failing MCP tools) and writes `retro/YYYY-MM-DD` with concrete, quoted skill edits backed by at least two occurrences. It proposes; it never edits skills.

Run it weekly as a [scheduled job](scheduled-jobs.md): an agent job in the DevHub repo with the prompt "Use the devhub-retro skill for the last 7 days."
