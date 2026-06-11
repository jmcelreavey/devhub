# Google Calendar

The Google Calendar integration shows upcoming events in DevHub and supports calendar-focused views.

## What It Enables

- Calendar widget on Today.
- Dedicated Calendar page.
- Week view of events.
- Better daily planning alongside tasks and notes.

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

## Empty States

The Calendar page distinguishes two cases:

| State | What you see |
| ----- | ------------ |
| Not configured | "No calendar connected" with a link to `/setup` |
| Configured, no events this week | "Nothing scheduled this week" — calendars are connected but the current week view is empty |

The sidebar Calendar link stays hidden until Google Calendar is fully configured (same
`/api/setup/status` gate as other integrations).

## Troubleshooting

| Problem                 | Check                                                    |
| ----------------------- | -------------------------------------------------------- |
| Sign-in fails           | Redirect URI exactly matches the URL used in the browser |
| Calendar page is hidden | Google Calendar is not fully configured                  |
| Empty week but events exist elsewhere | Only the current week is shown; check selected calendars in Setup |
| Events do not refresh   | Restart DevHub or re-run setup if credentials changed    |
