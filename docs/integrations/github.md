# GitHub

DevHub uses GitHub data for pull request tracking, repo awareness, and standup generation.

## What It Enables

- Open pull requests you authored.
- Pull requests waiting for your review.
- Recently merged PRs for standup notes.
- Repo discovery and quick actions.
- OpenCode-powered PR explanation/review notes from the dashboard.

## Recommended Setup

Install and authenticate the GitHub CLI:

```bash
gh auth login
```

DevHub can then use your existing local GitHub authentication instead of storing a separate token.

## Temporary Note And Doc Sharing

When GitHub is configured, DevHub can publish notes and docs as **secret gists** — unlisted links for short handoffs. Requires the same `gh auth login` session.

- Publish from the **Share** control in the notes/docs editor.
- Manage active links on **Live links** (`/shared`).
- Links auto-expire after 14 days.

See [Sharing](../guides/sharing.md) for the full workflow, security model, and troubleshooting.

## Pull Request Views

The PR views are meant to answer:

- What do I need to review?
- What do I have open?
- What recently merged work should appear in standup?

`/prs` and the Today GitHub PR panel both read `GET /api/github/prs`. The route uses
the local GitHub CLI session, filters archived repositories out of authored/review
queues, and keeps a short in-memory cache so the dashboard does not hammer `gh`
on every render.

### Row Actions

| PR list | Action | Result |
| ------- | ------ | ------ |
| Mine | **Copy request** | Copies a Slack-ready "ready for review" message. |
| Review requested | **Review** | Opens the terminal drawer and runs `opencode run` with the `pr-explain-review` skill. |
| Recently reviewed | **Copy approved** / **Copy reviewed** | Copies follow-up Slack messages. |

The **Review** action is intentionally local. It streams the explanation and review
in DevHub's terminal drawer and tells the skill to save the finished write-up as a
note through the notes MCP. It does **not** post comments, approve, or request
changes on GitHub unless the human explicitly asks the tool to do that later.

Review notes use a stable notes path:

```text
pr-reviews/<owner-repo-slug>-<pr-number>
```

For example, `BusinessInsider/Fancy Repo#123` becomes
`pr-reviews/businessinsider-fancy-repo-123`. Once the note exists, the dashboard
shows a **Notes** link beside that PR. After clicking **Review**, the link polls
for the note every few seconds; before a note exists, it renders nothing.

### Review Note Constraints

- `opencode` must be installed on `PATH`; otherwise the terminal prints an install
  hint instead of crashing the UI.
- When `NEXT_PUBLIC_REPO_ROOT` is set, the launch command exports `REPO_ROOT`
  and `NOTES_DIR` for the OpenCode run so the notes MCP writes into
  `notes/pr-reviews/...`, even if OpenCode is reviewing a different repository.
- The review skill writes through `notes_write`. Do not create review-note files
  by hand; that bypasses the notes MCP conversion and is how this stuff ends up
  in the wrong directory. Charming, but wrong.
- Re-running the review for the same PR overwrites the existing note at the same
  path.

## Standup Support

GitHub activity can contribute to standup markdown, especially merged PRs and review activity.

## Troubleshooting

| Problem | Check |
| ------- | ----- |
| PRs do not load | `gh auth status` succeeds. |
| Repo is missing | It has a GitHub remote and is discoverable from DevHub's repo search scope. |
| Archived repo PRs are missing | Expected: authored and review-requested rows from archived repos are hidden. |
| **Review** prints an OpenCode error | `opencode` is installed and available on `PATH`. See [OpenCode and OpenChamber](../guides/opencode-and-chamber.md). |
| **Notes** link never appears | The terminal review finished, the skill had notes MCP access, and it wrote to the exact `Notes MCP path` from the prompt. |
| Review note landed in the wrong place | `NEXT_PUBLIC_REPO_ROOT` mirrors `REPO_ROOT` in `dashboard/.env.local`; restart DevHub so the terminal command can pin `NOTES_DIR`. |
| Standup misses PRs | The PR was merged in the selected time window. |
