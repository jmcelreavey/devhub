---
title: Scheduled jobs
description: Run DevHub scripts or agent prompts on a cron schedule, catch up after sleep, and wake the Mac to do it.
order: 7
icon: Clock
tags: [workflow]
related:
  - reference/scripts
  - architecture/mcp-server
---

# Scheduled Jobs

Scheduled jobs run on a cron schedule inside the DevHub dashboard. A job does one of two things:

- **Script** — an allowlisted DevHub action (Update & Sync, Validate, Ownership Brief, …).
- **Agent** — an agent prompt in one of your repos, dispatched exactly like `agent_dispatch` (AionUi conversation, YOLO permissions, isolated worktree by default). No terminal tab opens.

Manage them on **Actions → Scheduled Jobs**, or from an agent through the DevHub MCP (see [From an agent](#from-an-agent-mcp)). When working with DevHub, prefer a DevHub job over a harness's own cron (`CronCreate`, `/loop`, `/schedule`, scheduled tasks, crontab): DevHub jobs outlive the chat session, catch up after sleep, can wake the Mac, and are visible to you in one place.

## When jobs run

- The scheduler checks the wall clock every 30 seconds while the dashboard is running.
- **Missed runs catch up once.** If the Mac was asleep or DevHub was closed at 07:00, the job runs on the next check — once, not once per missed occurrence.
- A new schedule, re-enabling a job, or approving it starts from *now*: time it did not have that schedule is not backfilled.
- A script job that is due while another action is running waits and retries on each check.
- Cron expressions are 5-field and use the Mac's local time.

In the desktop app, **closing the window hides it and keeps DevHub running** — on macOS a menu-bar tray icon appears while hidden (click it or choose **Show DevHub** to restore the window); the Dock icon also brings it back, and ⌘Q quits. Tick **Open DevHub at login** on the Scheduled Jobs card so jobs survive a reboot.

Only one DevHub process should run the scheduler. A dev server started beside the desktop app shares `~/.local/state/devhub/jobs.json`; start it with `DEVHUB_SCHEDULER=0`.

## Waking the Mac

Scheduling a wake needs root, so DevHub ships a tiny helper that does only that.

1. On **Actions → Scheduled Jobs**, click **Enable wake** (desktop app). macOS asks for your password once.
2. The helper is installed to `/Library/PrivilegedHelperTools/com.devhub.wake-helper` as a LaunchDaemon. It accepts three commands over `/var/run/com.devhub.wake-helper.sock` — schedule, cancel, status — and can only manage DevHub's own wake event.
3. Jobs with the alarm-clock toggle on (the default for new jobs) wake the Mac a minute before they are due. DevHub always schedules just the next one; `pmset -g sched` lists it under `com.devhub.wake-helper`.
4. While a job is about to run or running, DevHub holds a `caffeinate` idle-sleep assertion so the woken Mac stays up until the work finishes.

Turn wake off per job for anything frequent — an hourly job with wake on wakes the Mac every hour. **Remove wake helper** uninstalls it and cancels the pending wake.

The installed helper is independent of the app bundle, so rebuilding or reinstalling DevHub does not break it. When a DevHub release ships a newer helper (`jobs_list` and the card show its version), Remove and Enable it again.

## Agent jobs and approval

An agent job runs with approvals off every time it fires, so it needs a human before its first run:

- Created on the Actions page: approved immediately — you are the human.
- Created or rewritten from an MCP client that supports confirmation prompts: approved when you accept the prompt in chat.
- Otherwise it shows **waiting for approval** and never runs until you click **Approve**.

Changing an agent job's prompt, repo or provider from MCP sends it back for approval. An approved job skips any leftover CLI first-run dock chip — AionUi dispatch never showed one, and nobody is at the dock at 3am.

Agent runs still obey the usual caps (`DEVHUB_AGENT_MAX_RUNS`, `DEVHUB_AGENT_MAX_COST_USD`, …). A refused dispatch is recorded as the job's last error and logged; that occurrence is not retried.

## From an agent (MCP)

The `jobs` toolset of the DevHub MCP covers the whole feature. The server's instructions tell harnesses to use it instead of their own scheduling tools.

| Tool | What it does |
| ---- | ------------ |
| `jobs_list` | Every job with next/last run, the wake-helper status, and the scripts and agent providers a job can use |
| `jobs_get` | One job, including an agent job's full prompt |
| `jobs_create` | Schedule a script or agent job (`confirm: true`); wakes the Mac by default |
| `jobs_update` | Change name, cron, enabled, wake or the action (`confirm: true`) |
| `jobs_delete` | Remove a job (`confirm: true`) |
| `jobs_run` | Trigger now (`confirm: true`); follow with `scripts_run_status` or `agent_wait` |
| `jobs_log` | The scheduler activity log and the wake helper's log, optionally for one job |

Resources: `devhub://jobs` (jobs and wake status) and `devhub://jobs/log` (recent activity) for clients that read resources instead of calling tools.

MCP cannot approve agent jobs or install the wake helper — both need you, in DevHub.

## Logs and troubleshooting

Everything the scheduler decides is logged in plain language:

| Where | What |
| ----- | ---- |
| `~/.local/state/devhub/scheduler.log` (rotates at 1 MB to `scheduler.log.1`) | Startup summary; jobs created, updated, approved, deleted; each run with *why* it fired (on schedule, caught up N min late, manual) and how it ended; busy retries; dispatch refusals; every wake scheduled or cleared; wake-helper detection and errors; keep-awake holds and releases. Read it with `jobs_log` or `GET /api/jobs/log`. |
| Desktop log — **View → Show Logs** or `~/Library/Application Support/DevHub/logs` | The same scheduler lines (as sidecar output), plus `shell:background` (wake-helper install/uninstall, launch-at-login changes) and `shell:window` (window hidden/reopened). |
| `/var/log/com.devhub.wake-helper.log` | The root helper: startup with any pending wake, each wake scheduled or cancelled (UTC), refused requests. |

Common questions:

- **Did my job run?** `jobs_log` with the job id — look for `running …` and `… finished after Ns: exit 0`. The full output is in the run itself (`scripts_run_status` / `agent_output` with the run id from the log).
- **Why didn't the Mac wake?** Check `jobs_log` for `Mac will wake at …` before the job, and the helper log for `scheduled wake for …`. No helper lines means the helper is not installed; `wake helper not installed` in the scheduler log says the same.
- **A job ran twice / not at all while a dev server was up.** Only one process should own the scheduler — start the dev server with `DEVHUB_SCHEDULER=0`.
- **Enable wake says the command is not allowed.** The desktop build predates the wake commands; rebuild and reinstall the app.

## Good job candidates

| Job                   | Why                                     |
| --------------------- | --------------------------------------- |
| Update and sync       | Keeps local tools fresh                 |
| Validate              | Finds breakage early                    |
| Ownership brief       | Morning snapshot of owned-repo obligations and gaps (`0 7 * * 1-5`) |
| Capability digest     | Weekly tech-coverage scan + digest note |
| Agent: triage / review | A self-contained prompt run in a worktree before you start work |

## Safety tips

- Write agent prompts that are safe to run unattended and self-contained.
- Keep script jobs low-risk and reversible; review logs when a job fails.
- Do not schedule workflows that may expose secrets.

## API (dashboard running)

All routes need the same dashboard auth as other routes.

| Route | Method | Purpose |
| ----- | ------ | ------- |
| `/api/jobs` | `GET` | `{ jobs, scripts, providers, wake }` — jobs with `nextRunAt`/`lastRunState`, the script catalog, installed agent providers, wake-helper status |
| `/api/jobs` | `POST` | Create — `{ name, cron, script \| agent: { provider, prompt, cwd, model?, worktree?, maxTurns? }, wake?, enabled?, source?, confirmed? }` |
| `/api/jobs/log` | `GET` | `{ file, lines, helper }` — scheduler log tail; `?job=<id>` filters to one job, `?lines=` caps it (default 200, max 1000) |
| `/api/jobs/<id>` | `GET` | Read one job |
| `/api/jobs/<id>` | `PATCH` | Update `name`, `cron`, `enabled`, `wake`, `script` or `agent`; `{ approve: true }` approves an agent job (UI only) |
| `/api/jobs/<id>` | `DELETE` | Remove the job |
| `/api/jobs/<id>` | `POST` | Trigger now — `202` with `{ runId }` (a script run id or an agent run id) |

`source: "ui"` or `confirmed: true` marks the request as human-approved; anything else leaves new or rewritten agent jobs pending. Jobs are stored in `~/.local/state/devhub/jobs.json`.
