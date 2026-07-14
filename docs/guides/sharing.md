# Sharing Notes and Docs

DevHub can publish a note or doc as a **secret GitHub Gist** — a temporary, read-only link you can paste into Slack or email without committing the content to git.

## Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`).
- GitHub enabled in **Setup** (same gate as PR views and the **Live links** sidebar entry).

Publishing uses `gh gist create` / `gh gist edit` under the hood. DevHub does not store a separate GitHub token.

## Publish From The Editor

Open any note or doc. The **Share** control in the editor header:

1. Converts the current content to markdown (BlockNote notes → markdown via `blocksToText`; docs use the on-disk `.md` file).
2. Creates a **secret** gist (unlisted, but readable by anyone with the URL).
3. Copies the gist URL to your clipboard.

If the note is already live, clicking **Share** again (or **Update** on the **Live links** page) overwrites the gist with the current content.

Empty notes cannot be published.

## Live Links Registry

**Live links** (`/shared`) lists every gist DevHub is tracking:

| Column / state | Meaning |
| -------------- | ------- |
| Stale badge    | Source file changed since the last gist push (or the file was deleted) |
| Expiry label   | Auto-cleanup countdown (see below) |
| Update         | Re-push current content to the gist |
| Remove         | Delete the gist and drop the registry entry |

The registry is local state at `~/.local/state/devhub/shares.json`. It is **not** synced through git. Gists themselves live on GitHub under your account.

## Expiry And Cleanup

Live links expire **14 days** after they are first published. A background sweep (every six hours while the dashboard is running) deletes expired gists and removes their registry entries.

Use **Remove** or **Remove all** on `/shared` to unpublish early.

## Security Model

| Property | Behavior |
| -------- | -------- |
| Visibility | Secret gists — not listed publicly, but **anyone with the link can read** |
| Write access | Read-only for recipients; only you can update or delete via DevHub |
| Repo sync     | Shared content does not appear in `notes/`, `docs/`, or git unless you commit it separately |

Treat live links like unlisted URLs: fine for short-lived handoffs, not for long-term or sensitive archives.

## Troubleshooting

| Problem | Check |
| ------- | ----- |
| Share button fails | `gh auth status`; GitHub enabled in Setup |
| Live links nav missing | Enable GitHub in **Setup** |
| Stale badge won't clear | Open the note, edit if needed, then **Update** on `/shared` or re-share from the editor |
| Link stopped working | 14-day TTL may have expired; re-publish if you still need it |
| Wrong formatting in gist | Notes export plain markdown from BlockNote; complex blocks may simplify |

## Related Docs

- [GitHub integration](../integrations/github.md) — `gh` auth and PR views
- [Notes System](../architecture/notes-system.md) — vault storage and sidebar ordering
- [API Routes](../reference/api-routes.md) — `/api/share` endpoints
