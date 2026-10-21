---
title: Slack
description: Set up the Slack bot, answer tasks and follow agent progress.
order: 28
icon: Plug
tags: [slack, tasks]
related:
  - guides/task-checks-and-reviews
  - architecture/mcp-server
---

# Slack

The Slack bot posts new **Needs you** items, accepts task answers in threads and answers read-only questions over Socket Mode. It doesn't need a public URL. Retrying auto mode needs a separate **Confirm retry** click; typing `retry` or `start` in the channel doesn't run those commands. The bot has one settings form in [Setup → Slack](/setup#slack).

### Set up your workspace and bot

1. Create a free Slack workspace and a private channel, for example `#devhub`.
2. In **Setup → Slack**, click **Create Slack app**. Choose your workspace, review the prefilled manifest and create the app. Socket Mode, interactivity, bot events and the required permissions are already set. There's no request URL to fill in.
3. In the Slack app's **OAuth & Permissions**, choose **Install to Workspace**, allow the app and copy the **Bot User OAuth Token** (`xoxb-…`). Then open **Basic Information → App-Level Tokens → Generate Token and Scopes**, add `connections:write`, generate the token and copy the **App-level token** (`xapp-…`). Keep both private.
4. Paste both tokens into **Setup → Slack**. Open the channel's details in Slack and copy its **Channel ID**. Open your own Slack profile, choose **More → Copy member ID**, and paste it into **Your Slack member ID**. Don't use the bot's member ID. **Workspace ID** is optional; it's the `T…` part of your Slack workspace URL. Click **Save Slack settings**. Saved tokens are masked and never sent back to the browser. In the installed Mac app they're stored in `~/Library/Application Support/DevHub/config/.env.local`, not in Git. A checkout uses its ignored local env file, or `DEVHUB_ENV_FILE` when set.
5. Invite the bot into your private channel with `/invite @DevHub`. The status line shows whether it's connected. Click **Send test**, check the short message arrived, then ask `help` in the channel. Saving settings reconnects the primary DevHub process without a DevHub restart.

The member ID stays an explicit choice. `auth.test` identifies the bot, not the person who installed it, and DevHub won't trust the first person to send a message. The bot silently ignores other users, other channels, other workspaces, bot messages and message edits. When you leave Workspace ID blank, it pins the workspace to the bot's authenticated identity.

### Ask a question

```text
help
where's PTF-5135?
to do
what's running?
in review
blocked
done
needs me
what's waiting?
today
auto status
today in personal
needs me in work
```

Read-only queries use the active task profile unless you add `in <profile-name>` for that one query. That doesn't switch your profile in DevHub. An unknown profile is rejected rather than silently showing a different profile's tasks. Links retain the queried profile; DevHub may ask you to switch profiles before opening that task. Status and Needs you queries use the same Storyboard data and next-action resolver as Home, including workflow failures. Lists stop at eight items with `+N more`. Each query reply has one **Open in DevHub** button.

Replies appear in the question's Slack thread. **Open in DevHub** uses the local dashboard address (`http://localhost:1337` by default, or the configured `DEVHUB_BASE_URL`/server port). These are same-Mac links: localhost on a phone points at the phone, not your Mac. Jira titles and task details in replies leave DevHub and are stored by Slack.

### Ask for anything else (every DevHub tool)

If the keyword rules above don't match, the bot can use the whole DevHub MCP tool list, the same tools your agents have (about 240 across 34 groups). It reads the list from DevHub's own MCP server, so new tools show up on their own. It's cached for an hour; say `refresh the tools` to reload it.

```text
what's on my calendar this week?
open prs
search for deploy runbook
show my scheduled jobs
what did the nightly job do?
cost            (today's usage and spend)
```

How a message is routed, cheapest first:

1. **Keyword rules (free).** The Home-style rules above, then a short list of obvious one-tool questions (briefing, standup, jobs, running agents, search) and these cards, all with no Jev or model call:
   - `prs`, `my prs`, `owned prs`, `review requests`: one PR card with **Mine**, **Review requested** and **Owned repos**. Failing CI first, a 🟢🔴🟡⚪ dot, repo and age on each row, five per section with **Show more**.
   - `meetings today`, `meetings tomorrow`, `calendar`, `next meeting`: that day's events in your local time with join links; `next meeting` shows the time left and a **Join** button.
   - `my tickets`, `jira`: your assigned Jira tickets.
   - `worktrees`: finished worktrees (merged PR, stopped agent run, or folder gone) with clean or dirty, and **Clean up N**. That button only previews exactly what would be removed and what is skipped; the red **Confirm** after it is what deletes. Branches and commits stay.
   - Ticket commands (`start`, `plan`, `implement`, `mark … ready`, `note KEY: …`, `move KEY to …`) and the one-click task commands below.

   Arguments come from regex: a Jira key, the profile, your search words. No network call.
2. **Jev (about $0.0001 or less per question).** Anything else goes to Jev with the group names first, then the tools in the best group. Jev picks one option; it can also pick "search your notes", "ask what you mean" or "DevHub can't do that". Tool descriptions are sent as untrusted data. It uses the TypeSafe key from Setup.
3. **Cheap model (only when needed).** Only if the chosen tool still lacks required details, a result is long, or you ask for two steps ("… and then …"). It runs the **Cheap** tier from Storyboard model tiers, once, with a 45 second limit, and never any other tier. If no cheap tier is set, the bot says a model is needed and asks you to give the details. Model-filled details are checked against the tool's own input schema; if they don't fit, nothing runs and the bot asks you. A multi-step request runs at most three tool calls.

If Jev isn't sure (below 55% confidence, or a runner-up within 10 points), the bot asks **Did you mean…?** with up to three buttons instead of guessing. Picking one doesn't skip the safety step below.

**Reads run straight away.** Any tool DevHub marks read-only runs without asking. **Anything that changes something needs a Confirm click**, including every tool Jev picks: the card shows `Run <tool> in <profile>?` and the details. Tools marked destructive say "This can't be undone." and use a red button. The Confirm button works once, expires after 10 minutes, and only your configured member ID can use it. Jev and the cheap model can't run a write by themselves, and a multi-step plan stops at its first write. Typing `retry PTF-5135` or `start PTF-5135` now leads to one of these Confirm cards. `plan PTF-5135` asks first too, and says **Plan only — stops after the plan, no code changes**; `start PTF-5135 on auto` is the plan-then-build route.

**Reversible task changes run at once, with Undo.** `done PTF-5135` (or `done <words from the title>`), `reopen PTF-5135` and `add task <text>` (also `todo <text>`, `task: <text>`) happen immediately and the reply shows the task with **Undo** (good for 10 minutes) and **Open in DevHub**. `add task` saves a draft through the same capture endpoint as the Home box, so links, Jira keys and `#tags` read the same, and it never starts an agent. If several tasks match, you get the **Which task?** buttons and the change still waits for a Confirm. A task with an agent still working can't be checked off from Slack.

**Needs-you cards** carry **Plan**, **Implement** and **Open** on a task that is only waiting to be picked up (Open is the primary). Plan and Implement open a Confirm card; neither starts anything by itself. A card waiting on an answer or a retry keeps **Answer** or **Retry** as its one primary, plus Open.

Results are trimmed to Slack's limits and shown as plain text; long results are summarised to a few lines when a cheap model is set. **Open in DevHub** appears when the result carries a DevHub link.

**Profiles.** Add `in personal` or `in work` to scope one question. Each profile gets its own MCP connection started with that profile, so file-backed tools (notes, tasks, docs) read that profile. Tools that call the running dashboard use the dashboard's active profile.

**Cost.** Keyword rules cost nothing. A Jev-routed question is 1–2 Jev calls at about $0.042 per million input tokens (a repo estimate, not TypeSafe's live price), roughly $0.0001–$0.001 depending on how many tools it had to list. The cheap model's own cost isn't reported to DevHub, so Slack shows the number of model calls rather than a price. Say `cost` or `usage` for today's totals, or use the `integrations_slack_usage` MCP tool. Counts are kept in `usage.jsonl` next to the bot's other local state; no message text is stored there.

### Answer a task

**Post Needs you to Slack** is on by default in Setup and saves as soon as you click it. It posts new items for your active task profile, using Home's resolver, including requested PR reviews in owned repos. Each task gets one parent message and one next-action button; later items use that task's thread. A burst of more than five new items becomes one digest. Nothing already waiting is replayed when you connect, reconnect, switch profiles or wake the Mac.

Reply in a task thread to answer its oldest unanswered question. The bot says which question it answered and how many remain. **Answer** shows the question and asks you to reply in that thread; it doesn't open another form. Repo questions accept one recognised repo's full name or absolute path. When all questions are answered, auto mode carries on by itself. A thread always acts on its recorded profile, even if you've since switched profiles in DevHub. In a digest thread, use `PTF-5135: your answer` or the displayed task ID followed by `:`; the bot won't guess between tasks.

**Retry** first asks **Retry PTF-5135?** with **Confirm retry** and **Cancel**. Only your configured member ID can confirm. The confirmation expires after five minutes and works once, including across restarts. A failed or uncertain retry isn't repeated automatically.

An answer gets a short ✅ reply and an **Answered** status. If you answer in DevHub instead, the message changes to **Answered in DevHub**; other completed items become **Resolved**. Late replies don't overwrite answers. Turning posting off stops new posts, but existing threads still accept answers. `SLACK_POST_NEEDS_YOU=0` is the corresponding managed environment setting.

React with ✅ (`white_check_mark`, `heavy_check_mark` or `ballot_box_with_check`) to a bot message about one task to check it off. The bot replies in its thread with **Undo**, using the same reversible path as `done KEY`. Only your configured Slack user, workspace and channel count. A digest covering several tasks does nothing; a task with a running agent can't be checked off. Removing the reaction doesn't reopen the task: use **Undo** or `reopen KEY` instead.

### Home tab and agent progress

The app's **Home** tab shows live Needs-you counts, task cards, a few PRs and today's tasks. **Refresh** reloads it; Needs-you changes also refresh it after a short debounce while you've opened Home this session. **Plan** and **Implement** post their existing Confirm card in the configured channel or DM, not in Home. Nothing starts until you confirm there. Other users see only “This DevHub is private”.

**Post agent progress to Slack** sits beside the Needs-you toggle in Setup, defaults on and saves on click. It posts plan-ready, PR-opened, run-failed and needs-input milestones in the task's existing thread, or creates a root if there isn't one. It uses the existing Needs-you tick, not another poller, respects quiet hours and remembers milestones across restarts. The first pass records history without posting it; turning progress off records milestones silently rather than replaying them later. Set `SLACK_POST_PROGRESS=0` to turn it off through the managed environment setting.

### Plugin tools and attention

Slack discovers MCP servers from enabled plugins' `contributes.mcp` files and packaged plugins' runtime MCP endpoints. Their tools join DevHub's own catalog under a group named for the plugin. Tools added directly to the DevHub MCP server also appear, grouped by toolset metadata or name prefix. Installing or removing a plugin invalidates the cached catalog; enabled plugin catalogs refresh at least once a minute when used. No tool count is fixed in the router.

A tool annotated read-only can run directly. Unannotated tools always get a Confirm card; tools marked destructive get a red Confirm and the “can't be undone” warning. Slack's stricter risk overrides still win. OAuth-only plugin servers need an interactive sign-in and aren't connected by the bot.

Plugins don't currently declare an attention provider in their manifest. The Slack adapter adds an optional file contract: `plugin-needs/<plugin-name>.json` beside the plugin registry, containing `{ "items": [{ "id": "report", "title": "Review report", "reason": "Waiting on you", "href": "/reports" }] }`. Only enabled plugins are read. Missing text gets a fallback title and reason; missing or off-site links open DevHub home. These items appear in Needs you and App Home with an **Open** button; they don't start work.

### Connection and delivery

DevHub must be running and your Mac awake. The SDK reconnects after a dropped socket; DevHub doesn't fetch missed messages or catch up on reconnect. Only the primary server owns the socket: `DEVHUB_SCHEDULER=0` verification servers never connect. SDK logging is suppressed; connection failures appear as plain recovery instructions in Setup without tokens or raw provider responses.

Envelope IDs, event IDs and message timestamps are deduplicated in bounded local state next to workflow alerts, outside Git. Task-thread mappings and single-use confirmations are saved atomically beside that state. All bot posts, replies and edits share a pace of at most one operation per second. New posts preserve previously saved Slack quiet hours for that profile; replies and confirmations don't wait for quiet hours. Uncertain sends aren't replayed. **Send test** binds a request ID to the saved tokens, channel and active profile. Rechecking that request reads its recorded outcome rather than sending another copy. Check Slack before reloading Setup to start a new test after a failed or unknown outcome. **Remove connection → Disconnect Slack** removes the saved tokens and stops the bot, but doesn't delete Slack messages.

The manifest requests `chat:write`, `channels:history`, `groups:history`, `im:history`, `app_mentions:read` and `reactions:read`, and subscribes to `message.channels`, `message.groups`, `message.im`, `app_mention`, `reaction_added` and `app_home_opened`. It enables the app's Home tab. **Existing installs must update the app manifest and reinstall the app to grant `reactions:read`.** It doesn't request slash commands or workspace directory access. See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/), [app manifests](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/) and [auth.test](https://docs.slack.dev/reference/methods/auth.test/).


## MCP tools

`integrations_slack_status` reads connection status and masked settings. `integrations_slack_usage` reads today’s usage. `integrations_slack_test` sends one test message to the saved channel, using a request ID to prevent duplicate delivery.
