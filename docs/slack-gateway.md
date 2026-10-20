---
title: Team Slack gateway
description: One shared Slack connection, with each member's tools and credentials staying on their laptop.
---

# Team Slack gateway

Team Slack puts one small relay between Slack and each developer's DevHub. The gateway owns the company's Slack app connection. Each laptop opens an outbound WebSocket to it, so there's no inbound port, VPN route or public laptop URL to set up.

**Just me (direct) is still the default.** Existing tokens, member/channel allowlists, Socket Mode behaviour and settings carry on working. Switching modes doesn't erase those settings. Don't run direct mode with the shared app's app-level token: Slack distributes events between its connections rather than broadcasting them.

## What stays where

| Gateway | Each laptop |
| --- | --- |
| Slack bot/app credentials, member → device registry, short-lived routing scopes | Code, terminals, notes, tasks and personal data |
| Slack message and Block Kit delivery | Jira/GitHub/DB keys, MCP, Jev, routing and Confirm execution |
| Pairing codes and public keys | Ed25519 private key and locally installed plugins |

The gateway is **plugin-agnostic**. It never loads a tool catalogue or receives tool names as routing metadata. Each device discovers its own locally installed plugins through the existing Slack handlers. If one laptop has a plugin and another doesn't, only the first can use it. `run tool_name` resolves against that laptop's catalogue; unavailable tools say so. Plugin writes still require the usual Confirm card; destructive operations use the red button and the “can't be undone” warning.

Message text and tool results pass through the gateway in memory. It can see that content, just as Slack can. It doesn't log or persist message text, tool arguments, responses or tokens. Don't describe it as end-to-end encrypted: TLS protects the network connection, not content from the gateway operator.

## Create the Slack app

1. In Slack's app dashboard, choose **Create New App → From a manifest** and paste `gateway/manifest.json` from this checkout. Select the company workspace.
2. Install the app. Give the gateway its **Bot User OAuth Token** as `SLACK_BOT_TOKEN`.
3. Under **Basic Information → App-Level Tokens**, generate a token with `connections:write`. Supply it as `SLACK_APP_TOKEN`.
4. Keep Socket Mode enabled. The manifest includes `/devhub`, interactivity, DMs, mentions, Home and reactions. Invite the bot to any channels where people will use it.

The app needs `chat:write`, `commands`, `users:read`, `im:write`, the channel/group/DM history scopes, `app_mentions:read`, and reaction read/write scopes. Team collaboration adds `mpim:write`, `mpim:history`, `channels:read`, `groups:read`, and the `message.mpim` event. These allow group DMs and owner membership checks before posting a question in a channel. `users:read` is used for the linked display name, not email/SSO. Reinstall after changing scopes.

Only this gateway holds the shared Slack credentials. Never distribute them to developers' laptops.

## Run locally

Node **24 or newer** is required for the gateway's native TypeScript support. The dashboard keeps its own supported Node range. There's no build step or native dependency.

```sh
npm ci --prefix gateway --ignore-scripts
export SLACK_BOT_TOKEN='<bot-token>'
export SLACK_APP_TOKEN='<app-level-token>'
export GATEWAY_DATA_DIR='/path/outside/the/repository/gateway-data'
npm start --prefix gateway
```

Inject secrets through your shell or hosting secret manager. Don't put actual tokens in scripts, images, Git, command logs or a checked-in env file. These examples are placeholders, not tokens.

The default listener is `0.0.0.0:8080`. For a local-only pilot, set `HOST=127.0.0.1`. `GET /healthz` returns `{"ok":true}` while the service is running. Local devices can use `http://localhost:8080`; non-loopback URLs must use HTTPS/WSS.

The registry is one small JSON file with atomic, private-permission writes. Run **one gateway process/replica** against one persistent data directory. There is no shared SQLite/Redis cluster or distributed Socket Mode ownership. Back up that directory as identity metadata; it contains public keys and short-lived pairing codes, but no Slack credentials.

## Docker

Build from the repository root:

```sh
docker build -f gateway/Dockerfile -t devhub-slack-gateway .
docker run --rm -p 8080:8080 \
  --env SLACK_BOT_TOKEN --env SLACK_APP_TOKEN \
  --mount type=volume,source=devhub-slack-gateway,target=/data \
  devhub-slack-gateway
```

`gateway/Dockerfile.dockerignore` restricts the build context to gateway code, the shared protocol and dependency manifests. Notes, tasks, local configs and credentials are excluded. The container runs as the unprivileged `node` user; a bind-mounted `/data` must be writable by that user. Terminate TLS at a trusted reverse proxy and forward WebSocket upgrades to port 8080.

## Hosting examples

These are examples only. Nothing in this phase creates or deploys cloud resources.

### Fly.io

Use the repository root as the Docker context, `gateway/Dockerfile`, one machine, and a persistent volume mounted at `/data`. A starting `fly.toml` would look like:

```toml
app = "your-devhub-slack-gateway"
primary_region = "lhr"

[build]
  dockerfile = "gateway/Dockerfile"

[env]
  PORT = "8080"
  GATEWAY_DATA_DIR = "/data"
  GATEWAY_SSO_MODE = "off"

[[mounts]]
  source = "gateway_data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  method = "GET"
  path = "/healthz"
  interval = "30s"
  timeout = "5s"
```

Set the two Slack tokens through Fly's secret manager. Keep the machine on: the shared Slack connection must stay up even when no laptop is connected. Don't add a second replica with the same app token.

### Render

Use a paid, always-on **Web Service**, one instance, with a persistent disk at `/data`. Keep the repository root as the service root so the shared protocol is available. Use `npm ci --prefix gateway --ignore-scripts` as the build command and `npm start --prefix gateway` as the start command. Select Node 24, set `GATEWAY_DATA_DIR=/data`, and set the health check to `/healthz`. Render supplies `PORT` and TLS/WebSocket termination. Put tokens in Render's secret environment settings. An ephemeral/free sleeping instance isn't suitable for the registry or Slack connection.

## Environment

| Variable | Meaning |
| --- | --- |
| `SLACK_BOT_TOKEN` | Required bot token; gateway only |
| `SLACK_APP_TOKEN` | Required for Socket Mode, the default |
| `SLACK_SIGNING_SECRET` | Required only for optional Events API mode |
| `GATEWAY_SLACK_MODE` | `socket` (default) or `events` |
| `PORT` / `HOST` | Listener; defaults `8080` / `0.0.0.0` |
| `GATEWAY_DATA_DIR` | Persistent private registry directory; default `./data` |
| `GATEWAY_ADMINS` | Comma-separated Slack member IDs allowed to run `devices` |
| `GATEWAY_TRUST_PROXY` | Default off; `1` trusts `X-Forwarded-For` for IP limits. Only enable behind an edge that replaces/sanitises that header and blocks direct access |
| `GATEWAY_SSO_MODE` | Must be `off`; other values fail startup |

For Events API mode, disable Socket Mode in the Slack app and point **Event Subscriptions**, **Interactivity** and the `/devhub` request URL at `https://your-gateway/slack/events`. Set `GATEWAY_SLACK_MODE=events` and `SLACK_SIGNING_SECRET`. The endpoint verifies Slack's timestamp and constant-time HMAC signature before acknowledgement or routing. Socket Mode doesn't need a signing secret or a public Slack webhook.

## Link a laptop

1. Open **Setup → Slack → Team Slack (gateway)**. Enter the gateway URL and click **Connect to team Slack**.
2. DevHub generates an Ed25519 keypair, registers the public key, and shows an eight-character code.
3. **DM @DevHub: `link CODE`**. `/devhub link CODE` works too.
4. Setup updates to **Linked as @name** and shows connected/offline/reconnecting status. Needs-you and progress posts go to your own DM; App Home stays private to you.

Codes expire after ten minutes and are single-use. Link guesses are limited to five per member per ten minutes; a pending registration also expires after five failed authentication attempts. There are separate per-IP registration/auth and per-member event limits (20 events per minute). Nothing is queued while a laptop is offline. Slack gets: “Your DevHub is offline — open DevHub on your laptop and try again.” Unlinked members get the short Setup link instruction.

The private key lives outside the checkout at `$XDG_STATE_HOME/devhub/slack/gateway-device.json`, or `~/.local/state/devhub/slack/gateway-device.json`, with mode `0600`. The dashboard never returns it to the browser or logs it. Keep `XDG_STATE_HOME` outside Git. No Jira/GitHub credentials are sent during registration.

## Revoke or replace

Use **Unlink** in Setup while connected, or DM `unlink` / use `/devhub unlink`. The gateway revokes that member's device immediately and closes its socket. If the laptop is offline, use the Slack command; Setup won't pretend a remote revocation succeeded without acknowledgement.

Linking another laptop replaces the member's previous device. Slack explicitly confirms the replacement and the old device is revoked. There is one active device per `(team_id, user_id)`, and one authenticated socket per device. A new socket for the same key replaces the old connection rather than duplicating delivery. The laptop's scheduler guard and cross-process device lock still apply.

An administrator in `GATEWAY_ADMINS` can DM `devices` or run `/devhub devices`. It returns IDs, labels, link/last-seen times and revocation state, never public/private keys or content. Administrators don't get a tool execution path or access to other people's DevHubs.

## Ask a teammate and Hand off

These actions are available only while Team Slack is linked. Home and Storyboard task cards have Ask a teammate and Hand off buttons and menu items. Slack task cards have the same teammate selectors, plus an optional channel selector. Direct Socket Mode keeps its existing cards and behaviour.

### Ask a teammate

`listMembers` returns only the Slack IDs and names of other linked, non-revoked members in the same workspace. `askTeammate` takes an `askId`, helper Slack user ID, text, optional blocks and optional channel. The helper can't be the owner or the bot. They don't have to link a laptop to reply in Slack.

Without a channel, the gateway opens a group DM with the owner, helper and bot. With a `C…` or `G…` channel, it checks the owner's membership using Slack's paginated membership API. Membership results stay in memory for at most five minutes. No successful check means no post. The gateway strips device-supplied member/broadcast mentions from the text and blocks, then adds the helper mention itself.

Only the nominated helper's replies become `helper_reply` envelopes, addressed to the owner's device. Channel asks are thread-only; group DMs also accept the helper's top-level messages, with the latest active ask in that DM winning. The owner's own ask-thread and group-DM replies are ignored before any local router or model runs. The ask footer says Reply in this thread or Reply here to match the destination.

A helper reply produces a Suggested answer from @name card in the owner's DM. Send as answer uses the existing answer path only after the owner clicks. Edit opens the existing question form with the suggestion prefilled; Dismiss does nothing else. Tokens expire after ten minutes and bind the owner, device, profile, ask, question and reply hashes. Changed or answered questions cannot be approved.

If the owner's laptop is offline, the helper sees: `<@owner>'s DevHub is offline; they'll see your reply in Slack.` Other people replying in a bot-owned thread see: `This is <@owner>'s task. Ask them to add you.` These are fixed gateway-generated ephemerals, limited to one per user/thread per ten minutes with a bounded in-memory cache. Ordinary channel threads are ignored. Devices still can't send ephemerals to anyone but their owner. Asks expire after 24 hours; later helper replies don't reach a laptop.

### Hand off

`handoff` takes a `handoffId`, another linked member's Slack ID, text and blocks. The gateway posts to the receiver's DM, not a device-selected destination. The card must include buttons with action IDs `devhub_handoff_pickup` and `devhub_handoff_decline`. Pick up's `value` is a JSON object of at most 1,900 characters containing the pickup bundle; the full note belongs in the section blocks. The gateway relays this Slack-authored payload but never stores the bundle or note.

Only the receiver's currently bound device can receive those clicks or send `handoffResolve`. Click envelopes remain `block_actions`, with `handoff: { handoffId, fromUserId, fromName }`. An accepted resolution consumes the receipt once. Decline consumes it at the gateway. Pending handoffs expire after 24 hours, or when either laptop is revoked/replaced. An explicit `handoffResolve` outcome of `failed` also ends the handoff as `expired`, returning control through the existing terminal-result vocabulary. If the receiver only needs to clone a repository, don't resolve it: leave it pending so Pick up stays usable.

The owner receives a `handoff_result` envelope with top-level `handoffId`, `status` (`accepted`, `declined` or `expired`) and `byUserId`; `payload` repeats those three fields. If the owner is offline, the gateway sends a short DM instead. The receiver's card is replaced with gateway-generated terminal text and no buttons where Slack permits it. Failed Slack notifications/updates aren't automatically retried. `handoffStatus`, restricted to the original owner device, accepts up to 50 unique IDs and returns `handoffs: [{ handoffId, status, byUserId? }]` for reconnect reconciliation. Unknown or foreign IDs fail closed. There is no content queue.

Selecting a teammate prepares a red confirmation. It lists uncommitted files, explains that the agent will stop and the task will become read-only, and offers Jira reassignment when a ticket and local Jira connection exist. Clean checkouts offer Push and hand off. Dirty checkouts offer Commit WIP and push; only that explicit click creates a WIP commit, with hooks enabled. A changed checkout, failing hook or rejected push stops the handoff. Git uses validated argument arrays, never a shell, force or --no-verify. Only this task's branch is pushed.

The laptop records pending ownership before stopping the agent, so Auto, queued dispatches and Needs-you cannot race the push. The task shows Handing to @name… until accepted, then Handed to @name. Both states are read-only; decline or expiry returns control. Pending handoffs reconcile on reconnect and every minute. After the 24-hour deadline, the laptop checks gateway status before releasing control. If the gateway cannot be reached, it stays read-only rather than risk two owners.

Pick up finds a local clone by normalised origin, fetches the named branch and creates an isolated worktree using the existing helpers. A missing clone leaves the card pending with instructions to clone and retry. The receiver gets a draft task with the same title and ticket, the handoff note and its open question. It becomes actionable only after acceptance is acknowledged, and future agent runs use that worktree. Jira reassignment uses prepareJiraWrite/executeJiraWrite with the receiver's credentials; failure does not block pickup and is reported in their DM. An uncertain acceptance leaves the draft inactive for manual recovery rather than creating a second active owner.

The additive MCP tools task_ask_teammate and task_handoff use the same authenticated /api/team/collaboration server path as the UI. Ask needs Confirm in the Slack tool router. Hand off is destructive and posts the explicit red owner confirmation; invoking the tool alone never commits, pushes or stops an agent. No existing MCP tool schema changes.

### Stored metadata and compatibility

Ask receipts add `kind`, `askId`, `helperUserId`, `expiresAt` and optional `groupDm` to the existing owner/device/channel/timestamp metadata. `groupDm` distinguishes actual group DMs from private channels, which also have G-prefixed IDs. Handoff receipts add `kind`, `handoffId`, `toUserId`, `toDeviceId`, `expiresAt`, `status` and optional `byUserId`. The receiver device ID prevents replacement laptops inheriting an old card. Thread ownership is indexed across devices as well as by owner. All indexes share the existing 20,000-receipt bound. Persistence validates fields and rejects content/unknown fields; the gateway never stores message text, blocks, questions, bundles or notes.

The laptop keeps its own private team.json beside the Slack state, with atomic writes and private permissions. It stores ask context, handoff progress and pickup idempotency records. These local records do not cross the gateway's metadata-only storage boundary. Code moves only through git push/fetch; the Slack bundle contains identifiers and context, not code.

Devices opt in during authentication with `capabilities: ["ask", "handoff"]`. Earlier device clients didn't filter unknown envelope kinds at the transport boundary, so the gateway doesn't send new kinds or handoff click metadata to them. It uses the offline fallback instead. Updated clients drop malformed/unknown envelopes and validate member/status results before exposing them. Ordinary message, card and owner-scoped delivery rules stay in place.

## Security boundaries and limits

- Authentication is an Ed25519 signature over `nonce|deviceId|timestamp`. The random nonce is single-use, expires in 60 seconds, and the timestamp must be within 60 seconds of the gateway clock. Use clock synchronisation on both ends.
- A registered-but-unlinked socket can only wait for pairing or cancel it. It cannot receive Slack events or run delivery operations.
- The gateway derives the workspace/member/conversation from Slack, not from a device's request. Short-lived event scopes allow replies only in that event's conversation or the owner's DM/Home. Ordinary background posts are restricted to the owner's DM/Home; the explicit ask/handoff operations use the checked destinations described above. Device-requested ephemerals and Home publication can only target the linked owner.
- Updates and reactions require a bot-message receipt belonging to the same device and member. Handoff cards are changed only by the gateway and authorise only the named receiver while pending. Other cross-member message-action clicks are rejected before reaching a laptop. The laptop checks the authenticated device, linked owner, envelope audience/deadline and its existing message/action schemas again.
- Confirm cards are locally single-use, expiring and bound to the Slack member, device, argument hash and nonce. Another member/device, changed arguments or a replay cannot execute them. Tool names and execution policy stay on the laptop.
- Team mode also puts quick captures, task check-offs/reactions and Needs-you thread answers behind Confirm. An answer card shows the exact question and answer; a changed question requires a new reply. Direct mode keeps its existing quick-action/answer behaviour unchanged.
- Routing scopes and recent event IDs are bounded and held only in memory. The registry keeps ownership metadata for the latest 20,000 bot-message receipts (channel/timestamp, member and device IDs; no content), so progress updates and existing cards survive gateway restarts. Pruned or previous-device cards are refused rather than guessed at: ask DevHub again. No uncertain write is retried automatically.
- Treat a compromised laptop as that member: it can send to its own DM/Home and answer conversations whose events it received. A compromised gateway can observe relayed content. It still doesn't hold laptop code, local API keys or an MCP tool catalogue.

`gateway/src/sso.ts` defines `SsoIdentityMapper` as a future email → Slack identity hook. There is **no SSO implementation**. `GATEWAY_SSO_MODE=off` keeps the explicit Slack pairing flow in charge; enabling an unknown mode fails closed.

## Checks

```sh
npm run typecheck --prefix gateway
npm test --prefix gateway
cd dashboard && npx vitest run lib/integrations/slack/gateway-client.test.ts lib/integrations/slack/gateway-security.test.ts lib/integrations/slack/gateway-integration.test.ts
```

Root `npm run verify` and CI include gateway typechecking/tests. The dashboard's Slack integration test starts a gateway on a random localhost port with a fake Slack layer and two real outbound device transports. It covers pairing, per-member routing, rejected cross-user/channel operations, Confirm/replay rejection, offline/no-queue behaviour, revocation and different plugin catalogues on each laptop. Tests don't contact Slack or start agents.
