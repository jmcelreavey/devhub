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

## Repos Page

`/repos` is the local workspace for sibling git checkouts. DevHub scans `dirname(REPO_ROOT)` — typically `~/Developer` when DevHub lives at `~/Developer/devhub` — for direct-child folders containing `.git`.

| Section | API | Behavior |
| ------- | --- | -------- |
| Local repos | `GET /api/repos` | Branch, remote, dirty/unpushed counts, and whether a compose file exists (`docker-compose.yml`, `compose.yaml`, etc.). |
| GitHub search | `GET /api/repos/github?q=` | Requires `gh auth login`. Shows clone targets; already-cloned repos link to the local card. |
| Clone | `POST /api/repos/clone` | Body `{ fullName: "owner/repo" }`. Clones into the scan directory using the repo name as the folder. |
| Remove | `DELETE /api/repos/<name>` | Deletes the local folder. Cannot remove the current DevHub checkout. |
| Open | `POST /api/repos/<name>/open` | Cursor CLI when available. |
| Open Git | `RepoGitWorkspace` on the card | Full in-dashboard git UI (changes, branches, stash, history, conflicts, blame). Same component as the top-bar warning control for the DevHub checkout. |
| GitKraken | `POST /api/repos/<name>/open-gitkraken` | When `GET /api/repos/apps` reports `gitkraken: true`. |
| Compose | `POST /api/repos/<name>/compose-up` | `docker compose up -d` when the repo has a compose file and Docker is available. |

Repo Learning (`?learn=<name>` or the **Learn** action) only resolves repos from this scan directory. See [Repo Learning](../guides/repo-learning.md).

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
| Review requested | **Review** | Opens the terminal drawer and runs the configured **Agent CLI** (`opencode run` or `cursor-agent`; see `/setup → Agent CLI`) with the `pr-explain-review` skill. |
| Recently reviewed | **Copy approved** / **Copy reviewed** | Copies follow-up Slack messages. |

The **Review** action is intentionally local. It streams the explanation and review
in DevHub's terminal drawer and tells the skill to save the finished write-up as a
note through the notes MCP. It does **not** post comments, approve, or request
changes on GitHub unless the human explicitly asks the tool to do that later.

The `pr-explain-review` skill pulls full PR context before judging the diff:

- **Conversation** — top-level comments, review verdicts, and inline review threads (`gh pr view` + `gh api …/pulls/…/comments`).
- **Linked ticket** — Jira key from title/branch/body via `jira_ticket_get` when DevHub MCP is available, or the linked GitHub issue via `gh issue view`. Reviews answer "does this PR deliver what the ticket asks?" not just "is the code fine?".
- **Unresolved threads** — flagged when the diff does not address requested changes.

Saved notes include a **Ticket & Conversation** section when that context exists. See `skills/shared/pr-explain-review/SKILL.md` for the full workflow and note layout.

Review notes use a stable notes path:

```text
pr-reviews/<owner-repo-slug>-<pr-number>
```

For example, `BusinessInsider/Fancy Repo#123` becomes
`pr-reviews/businessinsider-fancy-repo-123`. Once the note exists, the dashboard
shows a **Notes** link beside that PR. After clicking **Review**, the link polls
for the note every few seconds; before a note exists, it renders nothing.

### Review Note Constraints

- The selected Agent CLI (`opencode` or `cursor-agent`) must be on `PATH`; otherwise
  the terminal prints an install hint instead of crashing the UI.
- When `NEXT_PUBLIC_REPO_ROOT` is set, the launch command exports `REPO_ROOT`
  and `NOTES_DIR` for the agent run so the notes MCP writes into
  `notes/pr-reviews/...`, even if the review targets a different repository.
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
| **Review** prints a CLI error | The selected Agent CLI (`opencode` or `cursor-agent`) is installed and on `PATH`. See [OpenCode and OpenChamber](../guides/opencode-and-chamber.md#agent-cli-selection). |
| **Notes** link never appears | The terminal review finished, the skill had notes MCP access, and it wrote to the exact `Notes MCP path` from the prompt. |
| Review note landed in the wrong place | `NEXT_PUBLIC_REPO_ROOT` mirrors `REPO_ROOT` in `dashboard/.env.local`; restart DevHub so the terminal command can pin `NOTES_DIR`. |
| Standup misses PRs | The PR was merged in the selected time window. |
