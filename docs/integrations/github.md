---
title: GitHub
description: PR tracking, repo awareness, and standup input via the local `gh` session.
order: 1
icon: GitPullRequest
tags: [integrations]
related:
  - guides/standup
  - guides/repo-learning
  - getting-started/setup
---

# GitHub

DevHub uses GitHub data for pull request tracking, repo awareness, and standup generation.

## What It Enables

- Open pull requests you authored.
- Pull requests waiting for your review.
- Recently merged PRs for standup notes.
- Repo discovery and quick actions.
- OpenCode-powered PR explanation/review notes from the dashboard.

## Walkthrough

[Pull requests and weekly review walkthrough](/api/notes-assets/assets/feature-demos/demo-05-prs-and-weekly-review.mp4)

## Recommended Setup

DevHub uses your local GitHub CLI session. It does not store a separate GitHub token in `.env.local`.

**From `/setup`:** click **Sign in with GitHub**. That is GitHub's device flow — a code plus `https://github.com/login/device` — the same protocol as `gh auth login --web`. DevHub polls until you approve, then runs `gh auth login --with-token` (and `gh auth setup-git`) on the server. The access token never reaches the browser. Device codes are held in process memory only and expire with the flow (~15 minutes) or a dashboard restart.

**From a terminal** (still supported):

```bash
gh auth login
```

Then press **Check connection** on `/setup`. `GET /api/setup/status` reports `github` / `githubVars.authenticated` from that `gh` session.

Scopes requested by the in-app flow: `repo`, `read:org`, `gist`, `workflow`, `read:packages`. Packages is extra vs `gh auth login --web` so Setup re-auth does not break GitHub Packages installs. To use your own OAuth app, set `DEVHUB_GITHUB_OAUTH_CLIENT_ID` (the default is GitHub CLI's public client id, which is what makes the token acceptable to `gh`).

## Temporary Note And Doc Sharing

When GitHub is configured, DevHub can publish notes and docs as **secret gists** — unlisted links for short handoffs. Requires the same `gh auth login` session.

- Publish from the **Share** control in the notes/docs editor.
- Manage active links on **Live links** (`/shared`).
- Links auto-expire after 14 days.

See [Sharing](../guides/sharing.md) for the full workflow, security model, and troubleshooting.

## Repos Page

`/repos` is the local workspace for sibling git checkouts. DevHub scans `dirname(REPO_ROOT)` — typically `~/Developer` when DevHub lives at `~/Developer/devhub` — for direct-child folders containing `.git`.

| Section       | API                                     | Behavior                                                                                                                                               |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local repos   | `GET /api/repos`                        | Branch, remote, dirty/unpushed counts, `worktreeOf` (owning clone when this folder is a git worktree), and whether a compose file exists (`docker-compose.yml`, `compose.yaml`, etc.). Filter chips: changed / unpushed / worktree. |
| GitHub search | `GET /api/repos/github?q=`              | Requires `gh auth login`. Shows clone targets; already-cloned repos link to the local card.                                                            |
| Clone         | `POST /api/repos/clone`                 | Body `{ fullName: "owner/repo" }`. Clones into the scan directory using the repo name as the folder.                                                   |
| Remove        | `DELETE /api/repos/<name>`              | Deletes the local folder. Cannot remove the current DevHub checkout.                                                                                   |
| Open          | `POST /api/repos/<name>/open`           | Cursor CLI when available. Optional `{ notePath }` opens a linked note as a persistent Markdown working copy alongside the repo (see [Cursor note working copies](../architecture/notes-system.md#cursor-note-working-copies)). Optional `{ filePath, commit? }` opens a working-tree file or a historical revision materialized beside the repo. |
| Open PR       | `GET /api/repos/<name>/pr`              | When `gh` is authenticated and the checkout is on a feature branch, shows a link to the open PR for that head branch plus rolled-up CI checks (`passing` / `failing` / `pending`). Skipped on the repo's default branch. Fetch is deferred until the card is near the viewport so large repo lists do not hammer `gh`. |
| Open Git      | `RepoGitWorkspace` on the card          | Full in-dashboard git UI (changes, branches, stash, history, conflicts, blame). Same component as the top-bar warning control for the DevHub checkout. |
| GitKraken     | `POST /api/repos/<name>/open-gitkraken` | When `GET /api/repos/apps` reports `gitkraken: true`.                                                                                                  |
| Compose       | `POST /api/repos/<name>/compose-up`     | `docker compose up -d` when the repo has a compose file and Docker is available.                                                                       |

Click a local card to open `/repos/<name>` — the [work hub](../architecture/dashboard.md#repo-work-hub) for that clone.

Repo Learning (`?learn=<name>` or the **Learn** action) only resolves repos from this scan directory. See [Repo Learning](../guides/repo-learning.md).

## Pull Request Views

The PR views are meant to answer:

- What do I need to review?
- What do I have open?
- What recently merged work should appear in standup?

`/prs` and the Today GitHub PR panel both read `GET /api/github/prs`. The route uses
the local GitHub CLI session, filters archived repositories out of authored/review
queues, and keeps a short in-memory cache so the dashboard does not hammer `gh`
on every render. Each active bucket (authored, review-requested) keeps up to **100**
rows — raised from 30 so review requests buried under Dependabot floods are not
silently dropped.

Authored and review-requested rows may include `approved: true` when a write-access
reviewer has a standing approval on HEAD. GitHub's `reviewDecision` is **null** on
repos that do not require reviews, so a `review:approved` search misses those PRs.
DevHub uses one GraphQL lookup (`reviewDecision` **or** `latestOpinionatedReviews`
with `writersOnly`) in parallel with the list searches. A later "changes requested"
cancels an earlier approval. A failed lookup returns an empty set — the list still
renders, just without ticks.

### Search and pin

The `/prs` search box is one control with two modes:

| Input | Behavior |
| ----- | -------- |
| Free text | Filters all three tabs (authored, review-requested, recently reviewed) client-side on title, repo, `repo#number`, author, and requested reviewers. Whitespace-separated terms are AND-ed (`meta syndication` narrows). |
| PR URL or `owner/repo#123` | Switches to **add** mode — pins the row at the top without leaving the page. |

When a phrase matches nothing locally, **Elsewhere on GitHub** calls
`GET /api/github/prs/search?q=` (debounced, min 2 chars). Results are scoped to
your GitHub orgs unless the query already carries search qualifiers (`author:foo`,
`repo:org/name`, etc.). Up to ten remote hits are shown, excluding PRs already in
your buckets. Closed/merged PRs show a state badge.

### Row actions

Each PR row shows the title (links to GitHub), metadata (`repo#number`, author, requested-reviewer facepile), a **Notes** glyph when a review note exists, and a **⋯** menu. Right-click or use the kebab to open the context menu — actions differ by tab:

| Tab | Menu actions |
| --- | ------------ |
| **Mine** (authored) | Open on GitHub · Copy PR URL · Copy Jira URL (when title contains a key) · **Open in Cursor** (stash if dirty, `gh pr checkout`) · **Review with agent** · Copy Slack request · Open review note |
| **Review requested** | **Review with agent** (or **Finish your daily rep first** when that PR is today's unfinished rep) · Open in Cursor · Open on GitHub · Copy URLs · Open note |
| **Recently reviewed** | Copy approved · Copy reviewed · Open in Cursor · Open on GitHub · Copy URLs |

The reviewer facepile is display-only. There is no dashboard **Request review** action and no `/api/github/prs/reviewers` route — request reviewers on GitHub.

**Open in Cursor** calls `POST /api/github/prs/open-in-cursor` — finds the local clone under the Repos scan directory, stashes dirty work, checks out the PR branch, and launches Cursor. Optional `notePath` opens a notes working copy alongside. MCP parity: `prs_open_in_cursor`. Requires the repo to be cloned locally.

**Review with agent** is intentionally local. It queues an agent job (`launchAgentJob`) that opens the **Agent** dock tab (or an OpenCode session when that is the resolved provider) with the `pr-explain-review` skill. It does **not** inject into a live shell tab. The skill saves the write-up through notes MCP. It does **not** post comments, approve, or request changes on GitHub unless the human explicitly asks the tool to do that later.

On the **Review requested** tab, if today's [daily review rep](../architecture/dashboard.md#daily-review-reps) is this PR and findings are not saved yet, the menu swaps **Review with agent** for **Finish your daily rep first** so the AI-free pass happens before the agent looks.

The `pr-explain-review` skill pulls full PR context before judging the diff:

- **Conversation** — top-level comments, review verdicts, and inline review threads (`gh pr view` + `gh api …/pulls/…/comments`).
- **Linked ticket** — Jira key from title/branch/body via `jira_ticket_get` when DevHub MCP is available, or the linked GitHub issue via `gh issue view`. Reviews answer "does this PR deliver what the ticket asks?" not just "is the code fine?".
- **Unresolved threads** — flagged when the diff does not address requested changes.

Saved notes include a **Ticket & Conversation** section when that context exists. See `skills/shared/pr-explain-review/SKILL.md` for the full workflow and note layout.

Review notes use a stable notes path:

```text
pr-reviews/<owner-repo-slug>-<pr-number>
```

For example, `Example-Org/Fancy Repo#123` becomes
`pr-reviews/example-org-fancy-repo-123`. Once the note exists, the dashboard
shows a **Notes** link beside that PR. After clicking **Review with agent**, the link polls
for the note every few seconds; before a note exists, it renders nothing.

Scaffolded review notes include a `## Links` section with an EntityRef back to the
PR (same cross-entity contract as task and meeting notes). Agents can also create
the scaffold with MCP `notes_create_pr`. See [Notes System — Cross-entity linking](../architecture/notes-system.md#cross-entity-linking).

### Review Note Constraints

- A usable AI provider must be installed or configured (`DEVHUB_AI_PROVIDER`:
  Cursor CLI, ChatGPT/Codex CLI, Antigravity CLI, OpenCode, or `AI_API_KEY`). Otherwise the Agent
  tab shows a setup hint instead of crashing the UI. See [Agent CLI selection](../guides/opencode-and-chamber.md#agent-cli-selection).
- When `NEXT_PUBLIC_REPO_ROOT` is set, the launch command exports `REPO_ROOT`
  and `NOTES_DIR` for the agent run so the notes MCP writes into
  `notes/pr-reviews/...`, even if the review targets a different repository.
- The review skill writes through `notes_write`. Do not create review-note files
  by hand; that bypasses the notes MCP conversion and is how this stuff ends up
  in the wrong directory. Charming, but wrong.
- Re-running the review for the same PR overwrites the existing note at the same
  path.

### Review notes in Git history

In the **Repo Git workspace** (History or Blame), DevHub parses each commit message for PR numbers and Jira keys and matches local review notes under `notes/pr-reviews/`. Context chips link to the note ("why was this accepted?") or open Jira directly. Match confidence: `pr` (same PR), `ticket` (same Jira key), `related` (same ticket, different repo). Hosted git UIs cannot make this jump — the notes stay local. API: `GET /api/repos/<name>/git/commit-context?commit=`.

## Standup Support

GitHub activity can contribute to standup markdown, especially merged PRs and review activity.

## Troubleshooting

| Problem                               | Check                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRs do not load                       | `gh auth status` succeeds.                                                                                                                                               |
| Repo is missing                       | It has a GitHub remote and is discoverable from DevHub's repo search scope.                                                                                              |
| Archived repo PRs are missing         | Expected: authored and review-requested rows from archived repos are hidden.                                                                                             |
| **Review with agent** shows a setup hint | A local CLI (`cursor-agent`, ChatGPT/Codex, `agy`, or `opencode`) is on `PATH`, or `AI_API_KEY` is set. See [Agent CLI selection](../guides/opencode-and-chamber.md#agent-cli-selection). |
| Approved tick missing on a reviewed PR | Expected when the repo does not *require* reviews **and** the GraphQL approval lookup failed. The Search API `review:approved` qualifier is not used — it misses those PRs. |
| **Open in Cursor** fails               | The PR's repo is cloned under the Repos scan directory and `cursor` is on `PATH`.                                                                                          |
| **Finish your daily rep first**        | Expected when this PR is today's unfinished [daily review rep](../architecture/dashboard.md#daily-review-reps). Save findings on `/review/rep` first.                     |
| **Notes** link never appears          | The agent job finished, the skill had notes MCP access, and it wrote to the exact `Notes MCP path` from the prompt.                                                       |
| Review note landed in the wrong place | `NEXT_PUBLIC_REPO_ROOT` mirrors `REPO_ROOT` in `dashboard/.env.local`; restart DevHub so the agent run can pin `NOTES_DIR`.                                                |
| Standup misses PRs                    | The PR was merged in the selected time window.                                                                                                                           |
