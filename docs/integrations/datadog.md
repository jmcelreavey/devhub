# Datadog

The Datadog integration gives quick access to alert-related views, on-call status, recent events, and optional AI investigation handoffs.

## What It Enables

- Datadog navigation item (`/datadog`).
- Today alert strip and morning-briefing on-call section.
- Deep links to useful monitor and event views.
- On-call roster matching via the Datadog On-Call API.
- Recent alert events for on-call and team Slack channels.
- **Investigate** button that spawns an OpenCode session with a structured prompt.
- MCP tools: `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate` (see [MCP Server](../architecture/mcp-server.md)).

## Setup

Configure Datadog from `/setup`.

| Setting                 | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Datadog API key         | Enables Datadog UI features, links, and API calls                       |
| Datadog application key | Required for Events search, On-Call API, and recent-alerts panels     |
| Datadog site            | Selects the Datadog region, such as US1 or EU                            |
| Work email              | Saved as `BI_OPS_USER_EMAIL`; matched against the on-call roster        |
| Schedule ID (optional)  | Saved as `DATADOG_ONCALL_SCHEDULE_ID`; comma-separated IDs to scope discovery in large orgs |

The Datadog nav item appears once **both** API key and application key are saved. Work email only controls on-call matching — the page is still reachable without it, but on-call panels stay quiet.

Without a schedule ID, DevHub auto-discovers on-call schedules (up to 100) and checks whether your work email is on the roster. Pin one or more schedule IDs when auto-discovery is too broad.

## On-Call Detection

`GET /api/datadog/oncall` asks Datadog who is on call and whether your configured email is carrying the pager. The check is **fail-closed**: missing config or upstream errors return `ok: false` with a code so the Today strip and briefing stay quiet rather than guessing.

| `code` (when `ok: false`) | Meaning |
| ------------------------- | ------- |
| `not_configured`          | No Datadog API key |
| `needs_application_key`   | Application key missing |
| `needs_email`             | `BI_OPS_USER_EMAIL` not set |
| `upstream`                | Datadog API error |

When `ok: true`, the response includes `onCall` (boolean), `users[]` (roster), and `checkedAt`.

## Recent Alerts

`GET /api/datadog/recent-alerts` fetches the five most recent alert events for on-call and team Slack queries. Requires API key + application key. Returns `oncall[]` and `teamSlack[]` event lists when successful.

## Investigate (OpenCode Handoff)

`POST /api/datadog/investigate` creates an OpenCode session and sends a structured investigation prompt. Body fields:

| Field | Purpose |
| ----- | ------- |
| `scope` | `"oncall"`, `"team"`, or `"general"` (default) |
| `title`, `status`, `tags`, `timestampMs` | Optional event context for the prompt |

Requires OpenCode running on the local peer port (`1338` by default). When `OPENCODE_SERVER_PASSWORD` is set, DevHub sends Basic auth to the OpenCode API. Returns `{ ok: true, sessionId }` or `502` when OpenCode is unreachable.

## Links Vs API Data

Some Datadog features are deep links (`GET /api/datadog/links`). Others call Datadog APIs (on-call, recent alerts).

Deep links need only an API key. On-call and event search require both API key and application key.

## Custom Links

DevHub can use custom Datadog URLs for common operational views via `DATADOG_LINK_ONCALL`, `DATADOG_LINK_TEAM_ALERTS`, and `DATADOG_LINK_EVENTS_TODAY`. Override the app origin with `DATADOG_APP_ORIGIN` when your site hostname differs from `DD_SITE`.

## Troubleshooting

| Problem                           | Check                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| Links open the wrong Datadog site | `DD_SITE` or `DATADOG_APP_ORIGIN` is correct                       |
| On-call always shows "not on call" | Work email matches your Datadog account; schedule ID scopes the right roster |
| On-call panel is empty / quiet    | Application key and work email are configured; check `/api/datadog/oncall` codes |
| Recent alerts unavailable         | Application key is configured                                      |
| Investigate fails with 502        | OpenCode peer is running; `OPENCODE_SERVER_PASSWORD` matches if set |
| Datadog page is hidden            | Both API key and application key are saved in setup                |
