---
title: Plan loop
description: Capture ideas as drafts, write them into plans, hand them to agents, follow the PRs, and learn from what finished.
order: 2
icon: Route
tags: [workflow, agents, tasks]
related:
  - guides/task-agent-handoff
  - guides/auto-pr-review
  - guides/scheduled-jobs
  - guides/skills
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

Draft rows show a dashed **Draft** chip and don't offer **Implement with Agent**.

## 2. Write the plan

Task menu → **Write plan with Agent…** opens a planning run with the `devhub-plan-write` skill. Pick a model that reasons well; the dialog remembers the planning model per CLI separately from the implementing one.

The agent investigates (read-only), writes `## Plan` and `## Acceptance`, lists anything only you can decide under `## Open questions`, and marks the task ready when nothing is left open. Planning runs show on **Agents → Activity** but aren't linked to the task, so Resume stays about the implementation.

For UI work, the planner can declare up to five specific, non-sensitive text or visibility assertions on the preview's initial page with `task_note_update` (`op: set_qa_scenario`) or the scoped planner's `task_plan_update`. The implementer can refine them. For a static build already in the task checkout, opt in with `upstarts/<repo>/preview.json`: `{"autoStart":true,"kind":"static","directory":"dist","path":"/"}`. The directory must be inside the checkout; don't set `command` or `port`. DevHub serves it on a loopback listener held through the run. Task URLs are ignored. Generated checks wait up to 60 seconds and don't use a model or interact with the page. A pass covers only those assertions, not the whole task.

If `preview.json` is missing, DevHub creates it and starts a preview for recognised Expo, Next.js and Vite apps. Detection uses the task checkout, not the main checkout. Generated configs run the installed framework CLI on an owned, loopback-only port; they don't run package scripts or install dependencies. Expo needs web support (`react-dom` and `react-native-web`). Missing dependencies get a specific reason so you can fix them and retry QA. Existing configs, including `autoStart: false`, are never replaced. Unrecognised apps still need a config.

For a custom dynamic app, use `{"autoStart":true,"kind":"dev","trustCommand":true,"command":"npm run dev -- --hostname 127.0.0.1 --port {port}"}`. `expo-web` can use the same opt-in with its own command. The command must use `{port}` and listen on `127.0.0.1`; don't set a fixed `port`. DevHub checks the listener's process group before forwarding requests. This needs Unix and `lsof`. Preview commands, including generated ones, run with the dashboard's environment and network access, not in a sandbox: use trusted checkouts with safe test data. Custom commands still require `trustCommand: true`.

The static listener proves which server the QA browser reaches, but it doesn't make the build safe to inspect. Use a dedicated build without real data or credentials. The server checks paths against the declared directory and sends a Content Security Policy that blocks cross-origin fetches and frames. It isn't a filesystem sandbox: files and symlinks can change between a path check and a read, including while QA runs. If the build's safety is unknown, record the gap and verify manually. Saved scenarios with interactive actions or no explicit wait-only menu are skipped automatically; run them manually only against a safe preview. Model-assisted scenarios may send task title, description and acceptance criteria, scenario context and goals, page text, URLs and screenshots to the provider. Missing credentials block decisions rather than pass them.

**QA lab** (`/qa`) is the place to save and run manual scenarios and browse run history. A task's Evidence panel links to the same receipt, including its assertions, screenshots and video. Manual scenarios can interact with the target, so use a preview with test data.

A before video must be requested during planning (`baselineRequired: true` or `Baseline capture: required`). Missing or late baselines show a reason. Generated baseline checks wait briefly for the capture; an absent post-change assertion is expected before implementation when a video exists.

## 3. Mark ready

Task menu → **Mark ready for an agent** (MCP `tasks_set_stage`). It runs the implement checklist with hard-block on:

1. Plan or acceptance written (or a Jira description).
2. No unchecked `## Open questions`.
3. At least one repo link (or a hub checkout). Several links are fine — the launch sheet picks which checkout to **start in**; **Add repo** never drops the others.
4. No open `#prerequisite` / `#blocker` tasks.

Gaps come back as an error toast with **Mark anyway**. **Move back to draft** is there for ready tasks that haven't started.

## 4. Implement

**Implement with Agent…** opens the Agents handoff sheet and starts a Paseo agent linked to the task. The dialog has an optional **Anything else the agent should know?** box, which reaches the agent under `## Extra context from me`, and the prompt makes the agent restate the goal, list its assumptions and ask anything open **before** it writes code. That check-in is posted to Activity (`agent_interactive_note`) so the scoping decisions are auditable next to the run. The chip shows **Running** until the conversation finishes or you cancel it (see [Task agent handoff](task-agent-handoff.md#interactive-leftover)). When it ends, a snapshot (branch, commit, changes, session) is appended to the handoff.

On Auto, verification runs without publishing by default and changes stay uncommitted. Select **Commit, push and open a PR before verification** when that workflow is wanted; opening a PR is not required for local verification.

## 5. Follow the PR

The dashboard checks the explicitly linked PR of each task's latest finished run every 10 minutes (`DEVHUB_TASK_PR_WATCH_INTERVAL_MS`). The agent records `prUrl` through `tasks_agent_runs` when it creates or works on that task's PR. A checkout branch or a PR mentioned as research context does not establish that link. Research and note-only runs keep their normal run status.

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

- MCP `tasks_plan_status`, HTTP `GET /api/tasks/plan-status`.

Buckets, most urgent first: PR needs a fix · merged (complete it) · PR closed · agent running · waiting on merge · stopped (resumable) · blocked · ready to hand to an agent · drafts to write up.

## 7. Share a plan

Task menu → **Copy plan as markdown**, MCP `tasks_plan_markdown`, or `GET /api/tasks/implement/plan?taskId=&date=&format=markdown`. One file with the task, note, handoff and runs — for a teammate or an agent that can't reach this machine.

## 8. Retro

The `devhub-retro` skill reads `tasks_retro_inputs` (finished and abandoned tasks, run outcomes, PR findings, failing MCP tools, and `skillUsage`) and writes `retro/YYYY-MM-DD` with concrete, quoted skill edits backed by at least two occurrences. It proposes; it never edits skills.

`skillUsage` is Claude Code Skill-tool invocations over the last **30 days**, least-used first (`lib/skills/usage.ts` streams `~/.claude/projects/**/*.jsonl`). A skill at zero is a retirement candidate for `skills/parked/` — but the count only covers Claude Code, not Cursor / Codex / OpenCode. This is not the `/review` weekly task bars; those are a different surface. See [Skills — Retiring a skill](skills.md#retiring-a-skill).

Run it weekly as a [scheduled job](scheduled-jobs.md): an agent job in the DevHub repo with the prompt "Use the devhub-retro skill for the last 7 days."
