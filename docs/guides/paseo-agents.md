---
title: Agents (Paseo)
description: Run DevHub's coding agents in the managed Paseo daemon — setup, ownership, phone access, and limitations.
order: 4
icon: Bot
tags: [agents, paseo, mcp]
related:
  - guides/agents
  - guides/scheduled-jobs
  - reference/environment-variables
---

# Agents (Paseo)

Paseo is DevHub's agent runtime. Older run records remain on disk; continue old tasks by starting a Paseo conversation with their saved handoff.

[Paseo](https://github.com/getpaseo/paseo) is a local daemon that runs Claude Code, Codex and OpenCode natively and other agents (Cursor, Copilot) over ACP, with its own web UI, mobile app and TypeScript SDK.

## Setup

Set **Agents password** in DevHub Setup (`DEVHUB_PASEO_PASSWORD`) before running the installer:

```bash
npm run agents:install
```

Or **Agents → Connection → Set up Paseo**. Works on **macOS** (launchd) and **Linux, including WSL2** (a `systemd --user` service, `devhub-paseo.service`; in WSL enable `systemd=true` in `/etc/wsl.conf`). The installer:

- installs the pinned `@getpaseo/cli` (`scripts/paseo-release.json`) through Safe-Chain into `~/.local/share/devhub/paseo`
- registers the `devhub.paseo.daemon` launch agent (macOS) or `devhub-paseo.service` (Linux) on `127.0.0.1:6767`, in the **foreground** — a detached daemon breaks Cursor's ACP agent ("Failed to initialize session services")
- sets the daemon password from the **Agents password** in Setup (`DEVHUB_PASEO_PASSWORD`; the legacy `OPENCHAMBER_UI_PASSWORD` still works), stored as a bcrypt hash, turns voice off (it otherwise downloads ~1 GB of speech models) and registers Cursor as an ACP provider when `cursor-agent` is installed
- keeps your other `config.json` edits, your default agent and your phone-access choice across reinstalls

The first time you open **Chats**, Paseo's web UI asks for a connection once: **Direct connection**, host `localhost`, port `6767`, the same password.

**Already running your own Paseo on 6767?** The installer refuses to start over it. A daemon older than 0.8 has no web UI, so **Chats** shows `Cannot GET /`. Stop yours first (`systemctl --user disable --now paseo` on Linux), then run setup. The managed daemon has its own home (`~/.local/share/devhub/paseo/home`), so chats from `~/.paseo` stay on disk but do not appear in it.

## Who owns what

| DevHub | Paseo |
| --- | --- |
| Dispatch rules: budget, depth, request claims, allowed roots | Harness processes, sessions, streaming |
| Run worktrees (`devhub/agent/…` branches, `agent_diff` baseline) | Chat UI, session import, agent handoff |
| Durable run records, task links, PR-review archiving | Permission modes per harness |
| Scheduled jobs (catch up after sleep, wake the Mac, approval gate) | Its own schedules for chats you start in Paseo |
| DevHub MCP (`devhub`) passed to each run | The user's own MCP config, loaded by each harness |

Each run is created with the harness's full-auto mode (`bypassPermissions` for Claude, `agent` plus auto-confirm for Cursor, `build` for OpenCode) and labelled `devhubRunId`. Results, token counts and cost come back from Paseo's timeline; cost is reported for Claude, not Cursor.

Task chips and **Open chat** go straight to the run's chat through `/api/paseo/open?run=<id>`.

## Connection tab

Shows daemon health, which agents are ready (and why not), the default agent for background work, and **Phone access**: **Pair a phone** enables Paseo's end-to-end-encrypted relay and shows a pairing QR. The pairing link controls your agents — treat it like a password. **Turn off phone access** disables the relay and restarts the daemon.

## Not replaced on purpose

- **Scheduled jobs** stay in DevHub: Paseo schedules don't document catch-up after sleep, waking the Mac, scripts, or an approval step.
- **`agent_dispatch` / `agent_race`** stay: they apply DevHub's budget and depth limits and link runs to tasks. Paseo's own agent tools default to off (`injectIntoAgents: false`); enabling them in Paseo Settings allows native orchestration outside DevHub's dispatch limits.
- **Run worktrees** stay DevHub's: Jira-keyed branches and the `agent_diff` baseline depend on them. Finished ones (merged PR or a stopped run) are listed on **PRs → Worktrees** (`/prs?tab=cleanup`).
- **Review MCP set** is smaller on purpose: review and auto-review attach only `devhub` and `lean-ctx`, so Cursor's tool cap does not drop Jira. Other launches attach every enabled non-builtin server.

## Known gaps

- **Claude model list.** Paseo ships its own hardcoded list of Claude models (`model-manifest.js`), so a model released after the pinned Paseo version is missing from its picker even when your Claude Code CLI supports it. Opus 5.5 and Sonnet 5.5 needed Paseo 0.10. When a new model is absent, bump `scripts/paseo-release.json` and `@getpaseo/client` in `dashboard/package.json` together, then **Agents → Connection → Update**. (Models named in `~/.claude/settings.json` are also merged in, but that changes what `sonnet`/`opus` mean in every Claude Code session.)

- Agent availability depends on the installed CLI and its authentication. Initializing or failed providers are not selectable. A provider catalog check is not an end-to-end model request; launch failures appear on the task and in Paseo.
- Paseo packaging (still true at 0.10.1): `@getpaseo/relay` points its import conditions at unshipped `.ts` files, so `next.config.ts` externalises `@getpaseo/*`; cancel uses the SDK's internal daemon client.
- Safe-Chain may delay a newly published release until it meets the package-age policy; a failed update keeps the installed version.

## Chats and setup

Paseo owns chat history, providers and plugins. DevHub has Chats, Usage and Connection tabs; old Activity links open Chats. Usage shows Claude and Cursor plan allowances and Codex spend from local logs, independently of Paseo. The Agents sidebar does not count historical DevHub runs as unread chats. A missing or pre-migration chat leaves Paseo available with a Back to chats action. Historical run records stay on disk for task results and automation.

Providers and plugins can be added from Paseo Settings inside Chats. Reinstalling or updating keeps those settings. Codex can be discovered from either the CLI PATH or the Codex/ChatGPT macOS app bundle.

DevHub-launched Cursor and Copilot chats enable Paseo's persisted Auto Accept feature. In chats started directly in Paseo, choose Auto Accept for ACP providers, Full Access for Codex, or Bypass for Claude; Paseo remembers the provider preferences. These choices apply to tool approval, not questions that need an answer from you.

Shared skills and specialist agents use the existing native-tool sync. Persona sync also maintains a marked block in Paseo's host system prompt, including the shared skill and agent locations, and preserves instructions written outside that block. This covers custom providers as well as the built-in harnesses.

## Updates

DevHub checks the npm stable release when opened and hourly while open. The banner appears only when Safe-Chain can install the update. Connection still shows a published release during its safety window and keeps checking. Paseo updates wait for active chats to finish and keep chat data, providers, plugins and personal settings.

The primary DevHub process also checks supported agent CLIs daily. It updates native Claude, Cursor and OpenCode installations with their own updater and npm-installed Claude, OpenCode, Copilot and Codex through Safe-Chain. It waits until Paseo chats are idle and retries later if Paseo is unavailable or a chat starts during the pass. Codex from the ChatGPT app follows the app's updates. Updates to other installation methods remain with their package manager. Set `DEVHUB_AGENT_AUTO_UPDATE=0` to disable DevHub's agent CLI updater; results are written to the scheduler log.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Agents or Status says the daemon is down | **Agents → Connection → Restart**. If that fails, `launchctl print gui/$(id -u)/devhub.paseo.daemon` and the log at `~/.local/share/devhub/paseo/devhub.paseo.daemon.log`. Re-running `npm run agents:install` is safe. |
| Cursor chats fail with "Failed to initialize session services" | The daemon was started detached. Reinstall with `npm run agents:install` so launchd runs it in the foreground. |
| Chats keeps asking for a connection | Use **Direct connection**, host `localhost`, port `6767`, and the Agents password from Setup (`DEVHUB_PASEO_PASSWORD`). Chats only auto-connects when DevHub is opened on this Mac. |
| A provider is missing or greyed out | The CLI isn't installed or signed in. Fix it in a terminal (`claude`, `codex`, `cursor-agent`, `opencode`), then refresh Connection. |
| A task run is stuck on "running" | Open the chat from the task chip. Paseo owns the session; DevHub reconciles the record from its timeline. |
