---
title: Google Calendar
description: Upcoming events in the Today view and the morning briefing.
order: 3
icon: Calendar
tags: [integrations]
related:
  - guides/standup
---

# Google Calendar

The Google Calendar integration shows upcoming events in DevHub and supports calendar-focused views.

## What It Enables

- Calendar widget on Today.
- Dedicated Calendar page.
- Week view of events.
- Better daily planning alongside tasks and notes.

## Walkthrough

[Calendar walkthrough](/api/notes-assets/assets/feature-demos/demo-03-calendar.mp4)

## Setup Summary

1. Create or select a Google Cloud project.
2. Enable the Google Calendar API.
3. Create OAuth credentials.
4. Add the DevHub callback URL as an authorized redirect URI.
5. Enter the client ID and secret on `/setup`.
6. Sign in with Google from DevHub.

## Redirect URI

Use the same host you use to open DevHub.

For local use, this is usually:

```text
http://localhost:1337/api/calendar/auth/callback
```

If you open DevHub from another device on your LAN, also add the LAN URL variant.

## Configuration

| Setting              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| Google client ID     | Identifies the OAuth app                                          |
| Google client secret | Secret for the OAuth app                                          |
| Refresh token        | Lets DevHub refresh calendar access without signing in every time |

## API behavior

Calendar reads go through local API routes (see [API Routes](../reference/api-routes.md)). All event routes fail soft on auth problems:

| Route                         | Returns when token is missing/expired      |
| ----------------------------- | ------------------------------------------ |
| `GET /api/calendar`           | `{ events: [], needsReauth: true }`        |
| `GET /api/calendar/week`      | `{ days: {}, needsReauth: true }`          |
| `GET /api/calendar/calendars` | `{ configured: false, needsReauth: true }` |

The UI shows a reconnect prompt instead of a hard error. OAuth starts at `GET /api/calendar/auth/start` (browser redirect) or via Setup; the callback is `GET /api/calendar/auth/callback`. Calendar selection persists through `POST /api/calendar/calendars` with `{ calendarIds }`.

## Troubleshooting

| Problem                 | Check                                                    |
| ----------------------- | -------------------------------------------------------- |
| Sign-in fails           | Redirect URI exactly matches the URL used in the browser |
| Calendar page is hidden | Google Calendar is not fully configured                  |
| Events do not refresh   | Restart DevHub or re-run setup if credentials changed    |
