---
title: Integrations and workflow alerts
description: Find and link Jira/GitHub work, review write proposals, accept allowlisted chat requests and opt in to workflow alerts.
order: 28
icon: Plug
tags: [integrations, tasks]
related:
  - guides/task-checks-and-reviews
  - guides/managed-browser
  - architecture/mcp-server
---

# Integrations and workflow alerts

Open **Integrations** to search Jira issues, GitHub Issues and pull requests, link them to tasks, and prepare write actions. Your own clicks in DevHub send immediately and are recorded. Anything an agent, MCP tool or chat command asks for waits for your review and confirmation first.

![Preparing a Jira action, reviewing its destination and cancelling without a write](../assets/demos/integration-proposals.gif)

*Real Integrations UI with invented provider responses. The action is cancelled; no Jira/GitHub write or chat message is sent.*

## Find and link work

Choose a provider, account and item type, then enter JQL for Jira or a GitHub search query such as `repo:owner/repository is:open`. Use **Inspect** to see the native status and open the provider's page. Jira can list available transitions; GitHub PRs can show check runs. These controls don't apply a transition or change task completion.

Open Integrations from a task's workflow to link a result to that task. Added links record the provider, account, item type and native ID, so matching IDs from different accounts stay distinct. Existing Jira keys and GitHub PR links remain available. **Remove link** only removes a link added through Integrations; edit legacy links in the task editor.

## Accounts and credentials

The `default` Jira account uses existing Jira setup. The `default` GitHub account uses the service's `gh` login. Neither needs a credential migration.

For another account, set named variables in the server environment and restart DevHub, then open **Accounts → Add an account**. Enter an account ID, display name and token variable name, such as `WORK_GITHUB_TOKEN`. Enter the variable name, not its secret value. Jira also needs its `team.atlassian.net` domain and an email variable name. Account metadata stores these references; the service resolves the credentials when making a request.

Additional accounts currently support Jira Cloud and GitHub.com. On Windows, configure credentials in the WSL service that runs DevHub. Removing an account removes its saved configuration, not its token at the provider.

## One click, or review and confirm

**Your own click is the approval.** Moving a ticket from a status chip, creating a ticket or using **Write actions** sends the request straight away: the chip changes at once (with a spinner on the chip only), and a toast reports "PTF-5106 moved to Done" with **Undo** and **Details**. Undo moves the ticket back by whichever transition your workflow offers; if Jira offers none, the toast says so. A rejected request puts the chip back and says why. **Details** opens the recorded action under **Recent actions**.

**Anything an agent or chat asks for waits for you.** `integrations_propose`, `jira_ticket_transition`, `jira_ticket_create` and `/devhub propose` create a proposal. Nothing is sent until you open **Integrations → Recent actions**, choose **Review action** and press the action-specific button. The review shows one heading, the ticket or PR, the change as From → To chips, the account by name and who asked. Transition ids, account ids, the destination URL and the request source sit behind **Details**.

Both paths use the same account, capability and remote-state checks and the same record. Direct actions are marked as such in the recorded action; reviewed ones say who requested them. Jira creation keeps the existing default account's parent, issue type, team, assignee and sprint handling. Named Jira accounts support ticket creation without sprint/team inheritance. PR updates keep the old title and description so they can be undone. PR creation defaults to draft and requires branches already pushed to GitHub. Publishing a draft is a separate action.

A proposal expires after 15 minutes. DevHub checks the remote revision and account again before sending. A changed preview needs fresh review. Jira and GitHub do not provide an atomic compare-and-write for every operation: another user can still change a branch or ticket between that check and the provider accepting the request.

**Recent actions** records cancelled, failed, succeeded and unknown outcomes. A timeout or interrupted request becomes **Outcome unknown** and is never retried automatically, whether you clicked or confirmed. Check Jira or GitHub before creating another action, because it could duplicate the first. Successful provider changes do not complete a DevHub task.

Proposals include ticket/PR content and stay in local profile state outside Git and content sync. Chat and MCP requests identify their origin in the review. These gates cover DevHub-owned operations; they do not sandbox other software or assistants with direct credentials.

## Slack

The Slack bot posts new **Needs you** items, accepts task answers in threads and answers read-only questions over Socket Mode. It doesn't need a public URL. Retrying auto mode needs a separate **Confirm retry** click; typing `retry` or `start` in the channel doesn't run those commands. Existing Slack webhook alerts and Telegram setup stay in **Integrations → Workflow alerts**; the bot has one settings form in [Setup → Slack](/setup#slack).

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

Envelope IDs, event IDs and message timestamps are deduplicated in bounded local state next to workflow alerts, outside Git. Task-thread mappings and single-use confirmations are saved atomically beside that state. All bot posts, replies and edits share a pace of at most one operation per second. New posts respect any enabled Slack workflow-alert destination's quiet hours for that profile; replies and confirmations don't wait for quiet hours. Uncertain sends aren't replayed. **Send test** binds a request ID to the saved tokens, channel and active profile. Rechecking that request reads its recorded outcome rather than sending another copy. Check Slack before reloading Setup to start a new test after a failed or unknown outcome. **Remove connection → Disconnect Slack** removes the saved tokens and stops the bot, but doesn't delete Slack messages.

The manifest requests `chat:write`, `channels:history`, `groups:history`, `im:history`, `app_mentions:read` and `reactions:read`, and subscribes to `message.channels`, `message.groups`, `message.im`, `app_mention`, `reaction_added` and `app_home_opened`. It enables the app's Home tab. **Existing installs must update the app manifest and reinstall the app to grant `reactions:read`.** It doesn't request slash commands or workspace directory access. See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/), [app manifests](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/) and [auth.test](https://docs.slack.dev/reference/methods/auth.test/).

## Telegram setup

You can use the same bot for outbound alerts and optional inbound commands. Alerts need a bot token and chat ID; they **do not need a public webhook**. Commands are a separate opt-in and only accept private chats.

![Setting up a Telegram destination, choosing a chat and sending a simulated test message](../assets/demos/telegram-setup.gif)

*Real Integrations UI with invented chat IDs and intercepted responses. No real bot token, webhook registration or Telegram message is used.*

### 1. Create your bot

In Telegram, open the official **@BotFather** account, send `/newbot`, then follow the prompts for a name and a username ending in `bot`. Keep the returned token private: anyone holding it can act as the bot. Never paste it into DevHub's UI, a ticket, a screenshot or a recording. See Telegram's [bot creation tutorial](https://core.telegram.org/bots/tutorial#obtain-your-bot-token).

### 2. Store the token on the server

Set `DEVHUB_TELEGRAM_TOKEN` in the environment of the service running DevHub, or in its ignored `dashboard/.env.local`. Restart that service. On Windows, this means the WSL service, not the Windows shell. Use the packaged app's environment when running DevHub.app rather than an unrelated checkout.

```dotenv
# Replace this placeholder locally; never commit the real value.
DEVHUB_TELEGRAM_TOKEN=<token-from-BotFather>
```

In **Workflow alerts**, enter only the variable name `DEVHUB_TELEGRAM_TOKEN` in **Bot token variable name**. A second bot can use a different server variable and its own destination.

### 3. Start or add the bot

For a private destination, open your new bot and choose **Start** (or send `/start`). For group alerts, add it to the intended group and send a command addressed to that bot. For a channel, add it with permission to post messages. Keep group privacy enabled unless you have a separate reason to change it. Inbound DevHub commands still require a private bot chat; group/channel IDs are for outbound alerts only.

### 4. Find the chat ID before registering a webhook

Open **Workflow alerts → Enable a destination**, choose **Telegram bot**, enter the token variable name and choose **Find my chat ID**. Select the intended recipient from **Chats found**; discovery never enables alerts or chooses a recipient automatically. It reads up to 100 pending updates server-side, newest within that batch first, and returns only chat type, chat ID and sender ID. It sends no message and supplies no offset, so it does not acknowledge or discard updates.

If no chats appear, send `/start` again and retry. Discovery refuses an active webhook and never calls `deleteWebhook`. If another app polls this bot, coordinate with its owner rather than interrupting it.

You can also inspect updates locally. This copyable command assumes the token is available in your shell; the token is deliberately a variable, not a literal. Don't enable shell tracing (`set -x`) or curl verbose output, and don't share the raw updates. `jq` shows only the IDs needed here:

```bash
curl --silent --show-error --fail-with-body --max-time 15 \
  "https://api.telegram.org/bot${DEVHUB_TELEGRAM_TOKEN}/getUpdates" \
  --data 'limit=100&timeout=0' \
  | jq '.result[] | (.message // .channel_post // empty) | {chat_id: .chat.id, type: .chat.type, user_id: .from.id}'
```

Record `chat_id` as a string, preserving a group's negative sign. For private commands, also record `user_id`; it normally matches the private chat ID. A helper bot you trust can sometimes identify your user/chat ID from a forwarded non-sensitive message, but privacy settings can hide the original sender and helpers see what you forward. Never forward a token or work content; verify the ID against your own bot before enabling alerts. See [getUpdates](https://core.telegram.org/bots/api#getupdates) and Telegram's [bot FAQ](https://core.telegram.org/bots/faq).

### 5. Enable alerts and test the destination

Add a label, select the events and read the fixed message preview. Approve the recipients/templates for the active work profile, then choose **Enable alerts**. Saving sends nothing. Use **Send test message** on the saved, enabled destination to send one fixed test immediately, even during quiet hours. The same control works for Slack, whose server variable is `DEVHUB_SLACK_WEBHOOK`.

A success means the provider accepted the test; check the actual chat. Errors explain rejected or uncertain delivery without showing tokens or provider response bodies. Tests appear in **Recent deliveries** and aren't retried automatically. Sending a test cannot enable a revoked destination, change consent or confirm a write.

### 6. Optionally configure inbound commands

Skip this step if you only want alerts. Generate a separate secret with `openssl rand -hex 32`, store it as `DEVHUB_TELEGRAM_WEBHOOK_SECRET`, and set these server variables. Replace the illustrative IDs and `work` with the private chat, sender and active profile shown in DevHub:

```dotenv
DEVHUB_TELEGRAM_COMMANDS=1
DEVHUB_TELEGRAM_WEBHOOK_SECRET=<generated-secret-not-the-bot-token>
DEVHUB_TELEGRAM_ALLOWLIST='[{"channel":"123456","user":"123456","profile":"work","accounts":["jira:default","github:default"]}]'
```

Restart DevHub. **Inbound chat commands** reports whether configuration is valid and how many sender/conversation pairs are allowed in this profile. Expose the exact webhook path as described next, then run this with the same token and webhook secret available in your local shell. Replace only the illustrative public origin:

```bash
DEVHUB_TELEGRAM_WEBHOOK_URL='https://hooks.example.com/api/integrations/chat/telegram'
curl --silent --show-error --fail-with-body --max-time 15 \
  "https://api.telegram.org/bot${DEVHUB_TELEGRAM_TOKEN}/setWebhook" \
  --data-urlencode "url=${DEVHUB_TELEGRAM_WEBHOOK_URL}" \
  --data-urlencode "secret_token=${DEVHUB_TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
```

`DEVHUB_TELEGRAM_WEBHOOK_URL` above is only a shell convenience, not a DevHub setting. Don't use `drop_pending_updates` just to finish setup: it discards queued messages. After registration, `getUpdates`/chat discovery is unavailable. The inbound handler checks Telegram's secret header and exact sender/chat/profile/account allowlist; it does not need to resolve the bot token. Send a fresh `/devhub help` in the private chat. Proposals still need human review and confirmation in DevHub.

### Expose only the webhook

Telegram needs a public HTTPS endpoint; tailnet-only Tailscale Serve cannot receive Telegram's requests. With **Tailscale Funnel**, put a path-restricting local reverse proxy in front of DevHub and funnel that proxy, not the whole dashboard. Funnel is public even if your normal dashboard address is private. Keep the original path intact and forward only `POST /api/integrations/chat/telegram` (plus Slack's exact path if used); return 404 for everything else. Follow the [Funnel documentation](https://tailscale.com/docs/reference/tailscale-cli/funnel) for TLS/port requirements. Don't expose `1337` wholesale or overwrite an existing Serve/Funnel configuration.

With **Cloudflare Tunnel**, a named tunnel can restrict the public hostname and exact path. Merge this into your tunnel's configuration, preserving its credentials and existing routes:

```yaml
ingress:
  - hostname: hooks.example.com
    path: ^/api/integrations/chat/telegram$
    service: http://127.0.0.1:1337
  - service: http_status:404
```

Validate the rules with `cloudflared tunnel ingress validate`, and check both the webhook and an unrelated URL with `cloudflared tunnel ingress rule`. The webhook must reach DevHub without an interactive Cloudflare Access login; all other routes must stay private or return 404. Preserve `X-Telegram-Bot-Api-Secret-Token`, don't log it or request bodies, and never use the bot token in a public URL. Cloudflare's [ingress configuration guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) describes exact-path matching and the required catch-all.

### Telegram troubleshooting

| Symptom | What to check |
| --- | --- |
| No chats found | Start the bot and send a fresh command. Updates already consumed by another reader may be absent. Confirm you're using the right bot variable. |
| Discovery reports an active webhook / 409 | Enter the saved chat ID manually. Don't remove a working webhook or use a negative offset to discard updates. |
| Test rejected / chat not found | Preserve the chat ID's sign; start/add the bot and give it permission to post. Confirm token and chat belong to the same bot. |
| Recipient blocked / 403 | Unblock the bot or restore its membership/permissions, then explicitly retry. |
| Credential changed | Restart after updating the server token, then **Change settings** and approve the destination again. Tests cannot bypass fresh consent. |
| Rate limited / 429 | Wait before sending another test; tests aren't automatically queued for retry. |
| Delivery unknown | Check the chat before retrying; a duplicate is possible. Inspect Recent deliveries rather than repeatedly clicking Test. |
| Commands disabled / configuration needs attention | Check `DEVHUB_TELEGRAM_COMMANDS=1`, valid allowlist JSON, active profile and a 32–256 character webhook secret; restart the correct service. |
| Webhook commands rejected | Use the same `secret_token` as the server secret, an exact private sender/chat pair and a fresh non-forwarded `/devhub` command. Chat cannot approve writes. |
| Webhook doesn't arrive | Check TLS, exact ingress path and header forwarding. Ensure no login screen intercepts it and DevHub is awake/running. Read `getWebhookInfo` locally for Telegram's pending/error status; don't publish its URL or errors unredacted. |

## Inbound chat commands

Inbound commands are separate from outbound alert consent and are disabled by default. Start with Slack, then Telegram private bot chats. Both require the active work profile and an exact sender/conversation allowlist. There is no wildcard, chat approval, shell execution or agent dispatch.

Configure these server environment variables locally and restart DevHub. Never commit their values:

| Provider | Variables |
| --- | --- |
| Slack | `DEVHUB_SLACK_COMMANDS=1`, `DEVHUB_SLACK_SIGNING_SECRET`, `DEVHUB_SLACK_ALLOWLIST` |
| Telegram | `DEVHUB_TELEGRAM_COMMANDS=1`, `DEVHUB_TELEGRAM_WEBHOOK_SECRET`, `DEVHUB_TELEGRAM_ALLOWLIST` |

Secrets must be 32–256 characters. Slack uses the app's signing secret. For Telegram, generate a random secret and supply that same value as `secret_token` when configuring `setWebhook`. The webhook reply uses Telegram's supported response-method format, so no bot token is stored by the inbound handler.

The allowlist is a JSON array. Use actual IDs and the work profile shown in DevHub; these are illustrative placeholders:

```json
[{"team":"T123","channel":"C123","user":"U123","profile":"work","accounts":["jira:default","github:default"]}]
```

Telegram uses numeric IDs as strings, omits `team` and accepts private chats only:

```json
[{"channel":"123456","user":"123456","profile":"work","accounts":["jira:default"]}]
```

Configure a Slack slash command named `/devhub` with an HTTPS request URL ending in `/api/integrations/chat/slack`. For Telegram, register `/api/integrations/chat/telegram` as the HTTPS webhook and request message updates. Expose only these exact webhook paths through the ingress; keep the dashboard and its write-confirmation endpoints behind authenticated access. This setup does not create a tunnel or expose a port for you.

Slack requests use HMAC verification over the raw body and a five-minute timestamp window. Telegram checks the webhook secret, message age, sender and private chat; forwarded and bot messages are rejected. Both persist replay receipts and limit each sender to ten unique commands per minute, with a global receipt ceiling. Disable the relevant `COMMANDS` variable and restart to revoke inbound access. Already queued proposals still need dashboard confirmation and can be cancelled there.

Commands:

- `/devhub help` lists the command grammar.
- `/devhub status` counts this sender's pending proposals; `status <proposal-id>` reports one outcome.
- `/devhub propose <JSON>` validates and queues one action. It performs no Jira/GitHub write and replies with the proposal ID. Open **Integrations → Recent actions** to review and confirm.

Example Jira ticket:

```text
/devhub propose {"action":"issue.create","provider":"jira","account":"default","projectKey":"APP","title":"Investigate the failing build","body":"Check the failure and record the fix."}
```

Example transition:

```text
/devhub propose {"action":"issue.transition","provider":"jira","account":"default","ref":{"provider":"jira","account":"default","kind":"issue","id":"APP-123"},"transitionId":"31"}
```

Example draft PR:

```text
/devhub propose {"action":"pr.create","provider":"github","account":"default","repo":"owner/repository","head":"feature/fix","base":"main","title":"Fix the build","body":"Describe the change and verification.","draft":true}
```

For `pr.update`, use a GitHub `ref` with kind `pr` and ID `owner/repository/123`, plus `title` and `body`. For `pr.publish`, use the same ref without title/body. Replies contain fixed status text and IDs; they do not echo ticket descriptions or provider errors. Command content itself is visible to the chat provider. Slack replies are ephemeral; Telegram bot chats are not secret chats.

The protocol follows [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/) and the [Telegram Bot API webhook contract](https://core.telegram.org/bots/api#setwebhook). WhatsApp stays parked; its paid Business API is outside this implementation.

## Enable workflow alerts

Alerts are off until you enable a destination. They apply to the active work profile shown on the page. Slack uses an incoming webhook for one chosen channel; Telegram uses a bot token and an explicit chat ID. WhatsApp is unavailable.

1. Set the Slack webhook URL or Telegram bot token in the server environment and restart DevHub. For Telegram, start the bot or add it to the chosen chat first.
2. Open **Workflow alerts → Enable a destination**. Choose the channel, add a label and enter the credential variable name. For Telegram, enter the chat ID too.
3. Select the event types. You can receive conversation attention, failed checks, review readiness, approval requests and PR attention.
4. Optionally set quiet hours with their time zone, and an authenticated HTTPS DevHub address reachable from your phone.
5. Read the message preview and approve the templates for that destination and work profile, then choose **Enable alerts**.

Enabling alerts sends no test message. **Send test message** is a separate explicit send for an enabled Slack or Telegram destination and records its result in Recent deliveries. Tests bypass quiet hours but never consent; rate-limited tests aren't automatically retried. Only matching workflow events after consent are queued. The worker delivers while DevHub is running and the matching work profile is active.

Messages contain fixed event text and, if configured, a task link. They don't include task titles, code, logs or conversations. The destination's recipients and provider can read and retain the message. Telegram bots don't use secret chats. Approvals still happen inside authenticated DevHub.

The optional address must be an HTTPS origin with no path, query, token or fragment, for example `https://devhub.example.com`. Configure authenticated remote access separately. A localhost link would point at the phone itself, so leaving the address blank sends instructions to open Task workflows instead.

## Delivery, retries and revocation

**Recent deliveries** shows pending, sent, failed, cancelled and unknown deliveries. Sent means the provider accepted the message; it doesn't mean someone read it. The durable outbox deduplicates workflow events and survives a DevHub restart. Quiet hours delay pending messages until the configured window ends.

Rate limits retry after the provider's delay with backoff, up to five attempts. A timeout, ambiguous response or restart during delivery leaves the result **unknown**. DevHub won't retry an unknown delivery automatically. Check the channel first, then acknowledge the possible duplicate before using **Retry delivery**. You can also cancel pending, failed or unknown deliveries.

**Revoke alerts** cancels queued deliveries under that consent. It can't retract messages already sent. Consent records a hash of the resolved credential as well as the work profile and selected events. If the credential changes, use **Change settings** to confirm its recipient with fresh consent. **Review and re-enable** restores a revoked destination without creating another record. Saving settings cancels the old consent’s queued deliveries.

Destination settings and the outbox stay in local profile state outside content sync. They contain credential variable names and hashes, not raw tokens or webhook URLs.

## Adding a provider

Source plugins can declare `dashboard.providers`. Each module exports a default array of `IntegrationProvider` objects. DevHub materialises static imports into an empty generated core baseline; a rebuild is required. Edit the plugin source rather than the copied dashboard files.

Packaged runtime plugins use a separate versioned `request-worker` protocol for reviewed pages, routes and MCP contributions. That protocol doesn't register source provider modules automatically or permit arbitrary imports into the packaged dashboard. Write-capable adapters implement `prepareWrite` and `executeWrite` alongside their advertised capabilities. The host owns proposal storage, expiry, review hashes and single-use execution. An adapter receiving an approval ID is trusted application code, not a security sandbox.

## Verification scope

Slack coverage uses an injectable SDK client with no live workspace calls: manifest decoding, managed settings and masking, authenticated routes, allowlists, durable deduplication, profile-local reads, deterministic routing, Home's next actions, one-button Block Kit replies, restart/reconnect handling, test-delivery uncertainty and the instrumentation single-owner guard. Setup controls cover loading, validation, save, masked fields, tests and disconnect. Tool routing is tested with a mocked MCP session (more than 255 tools, to exercise category-first routing), a mocked Jev and a mocked cheap model: rule short-circuits, low-confidence buttons, write confirmations (single-use, expiry, wrong user, destructive wording), schema-checked argument filling, summaries, the three-step cap and the usage log. A real stdio connection to the MCP server was checked by hand; Jev and the cheap model were not called live. Live Slack app creation, workspace installation and socket delivery still need a real workspace check.

Write and inbound-command fixtures cover confirmation, concurrent duplicate submission, stale previews, expiry, profile/account isolation, unknown outcomes, provider payloads, signed requests, allowlists and replay limits. No real Jira/GitHub writes or Slack/Telegram sends were performed; these tests use mocks.

Telegram coverage includes fixed Slack/Telegram test payloads, consent revisions, profile isolation, concurrent request deduplication, crash/unknown recovery, rate limits, redacted failures, non-consuming chat discovery, active-webhook refusal, authenticated API routes, read-only MCP status and UI success/error/empty states. Run `npm run test --prefix dashboard -- lib/integrations/alerts.test.ts lib/integrations/telegram.test.ts app/api/integrations app/integrations ../mcp-servers/devhub-server/src/tools/reviewed-workflows.test.ts --maxWorkers=2`, then `npm run verify`.

The Telegram setup GIF uses the existing disposable fixture/CDP/sharp pipeline (`DEMO_ONLY=telegram-setup DEVHUB_DEMO_SERVER=dev npm run demos:walkthroughs`), with invented IDs and intercepted discovery/consent/test responses. No live Telegram call occurs.

The proposal GIF exercises the review/cancel controls with mocked provider responses, not a live write. Native webviews, live-provider behaviour and externally exposed ingress remain separate verification work.

## From an agent

`integrations_slack_status` reads masked bot settings, the current settings revision, connection state and active task profile. `integrations_slack_usage` reads today's bot usage (questions, free rule answers, Jev calls and estimated cost, model calls). `integrations_slack_test` sends the fixed test to that saved channel using the returned revision and a UUID `requestId`. Reuse the request ID after uncertain transport. Neither tool changes Slack settings, enables alerts or runs a task action.

`integrations_list` reads providers, capabilities and account references; `integrations_proposals` reads the active profile's action history. `integrations_propose` creates a request and `integrations_review` prepares its preview. Neither executes a provider write, and there is no integration-confirm MCP tool. Open **Integrations → Recent actions** for the human's action-specific confirmation. `integrations_alert_destinations` lists saved destinations, consent revisions and recent deliveries, never tokens. `integrations_alert_test` sends a fixed test to an already enabled destination using `id`, its current `revision` and a UUID `requestId`; reuse that request ID after an uncertain transport result to avoid another send. `integrations_chat_status` reads command status, active-profile allowlist counts, webhook paths and required variable names without exposing their values. These tools cannot enable alerts/commands, edit an allowlist or approve writes. See [MCP server](../architecture/mcp-server.md#integration-proposals).
