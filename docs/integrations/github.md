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
- PR explanation and review notes written by Paseo agents.

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

`/repos` is the local workspace for sibling git checkouts. DevHub scans `DEVHUB_REPOS_DIR` when set, otherwise the parent of the checkout — typically `~/Developer` when DevHub lives at `~/Developer/devhub` — for direct-child folders containing `.git`.

| Section       | API                                     | Behavior                                                                                                                                               |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local repos   | `GET /api/repos`                        | Branch, remote, dirty/unpushed counts, `worktreeOf` (owning clone when this folder is a git worktree), and whether a compose file exists (`docker-compose.yml`, `compose.yaml`, etc.). Filter chips: changed / unpushed / worktree. **Changed** ignores macOS/Python/Terraform cache clutter (`.DS_Store`, `__pycache__`, `.pyc`, `.terraform`) so those files do not light the chip; in the DevHub checkout, vault content (`notes/`, `tasks/`, …) is also excluded (it uses content-sync instead). **Unpushed** is `0` when the upstream branch is gone (typical after a merged PR deletes the remote branch) — those commits are not a push queue. |
| GitHub search | `GET /api/repos/github?q=`              | Requires `gh auth login`. Shows clone targets; already-cloned repos link to the local card.                                                            |
| Clone         | `POST /api/repos/clone`                 | Body `{ fullName: "owner/repo" }`. Clones into the scan directory using the repo name as the folder.                                                   |
| Remove        | `DELETE /api/repos/<name>`              | Deletes the local folder. Cannot remove the current DevHub checkout.                                                                                   |
| Open          | `POST /api/repos/<name>/open`           | Cursor CLI when available. Optional `{ notePath }` opens a linked note as a persistent Markdown working copy alongside the repo (see [Cursor note working copies](../architecture/notes-system.md#cursor-note-working-copies)). Optional `{ filePath, commit? }` opens a working-tree file or a historical revision materialized beside the repo. Optional `{ worktree }` (absolute path or branch) opens that linked worktree instead of the main checkout — use it when an agent run's code lives under `<repos-dir>/.devhub-worktrees/<repo>/`. |
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
| Free text | Filters the PR tabs (Mine, Review requested, Recently reviewed, Skipped) client-side on title, repo, `repo#number`, author, and requested reviewers. Whitespace-separated terms are AND-ed (`meta syndication` narrows). The **Worktrees** tab is a local git scan, not a PR list — search does not apply there. |
| PR URL or `owner/repo#123` | Switches to **add** mode — pins the row at the top without leaving the page. |

When a phrase matches nothing locally, **Elsewhere on GitHub** calls
`GET /api/github/prs/search?q=` (debounced, min 2 chars). Results are scoped to
your GitHub orgs unless the query already carries search qualifiers (`author:foo`,
`repo:org/name`, etc.). Up to ten remote hits are shown, excluding PRs already in
your buckets. Closed/merged PRs show a state badge.

### Finished worktrees

Agent runs (and some PR checkouts) leave extra git worktrees under
`<repos-dir>/.devhub-worktrees/<repo>/`. They accumulate until something deletes
them. **PRs → Worktrees** (`/prs?tab=cleanup`) is the cross-repo list of leftovers
that look safe to remove — not a dump of every `git worktree list` row.

A worktree is listed only when one of these is true:

| Reason | Evidence |
| ------ | -------- |
| `pr-merged` | Its branch has a merged GitHub PR (last 100 merges for that repo) |
| `run-finished` | An agent run used this path and is no longer active |
| `folder-missing` | Git still lists it but the folder is gone (`prunable`) |

Locked worktrees, the main checkout, active runs, and anything without that
evidence stay off the list (returned as `kept`). Removing a row deletes **the
folder only** — the branch and commits stay. A dirty tree returns `409` with
`code: "worktree_dirty"`; the UI asks before force-remove.

Today shows a one-line count (`WorktreeCleanupNudge`) that links here. It is not
dismissible; it disappears when the folders are gone. Per-repo add/remove/lock
still lives on the Git workspace **Worktrees** tab.

The older cross-repo panel uses `GET`/`POST /api/repos/worktree-cleanup`.

For reviewed bulk removal, open **Repos → worktree count → Worktrees**.
Extra checkouts appear first, with their cleanup status and linked work under
**Details & linked work**. The main checkout is always kept. The Worktrees tab
checks GitHub and offers **Select ready** when merged checkouts can be removed. Previews share
results for up to a minute; removal always fetches fresh evidence. A checkout qualifies
when its HEAD matches, or is an ancestor of, the merged PR's original head. It
also checks the current remote default branch: if a conflict-free trial merge
would leave its files unchanged, the checkout is already integrated. This covers
squash merges, rebased or cherry-picked commits, and deleted remote branches.
The check uses `git merge-tree`; it never rebases, edits files or moves branches.
Custom merge drivers cannot be used as evidence because they can discard changes.
Open PRs, dirty files, active agent runs, open DevHub terminals, locks and
unverified local commits still block removal. A finished task alone does not
make an open PR ready for cleanup. Ignored files require a separate acknowledgement.

MCP uses `repos_git_worktrees` with `action:"review"`, then `action:"cleanup"`
with the reviewed `entries:[{path,head}]` and `confirm:true`. Set
`includeIgnored:true` only after reviewing those files. Cleanup verifies merge
evidence again, checks that HEAD hasn't moved and never force-removes. The API is
`GET /api/repos/<name>/worktrees?details=1` and `POST /api/repos/<name>/worktrees`
with `confirmed:true` and `mergedOnly:true`; results include `removed` and
per-path `errors`.

**Clear missing entries** only forgets missing folders. The scheduled worktree scan reports
candidates; it doesn't delete them. Paseo unpinning also leaves the checkout on
disk. Planning uses the existing checkout; a new task implementation gets an
isolated worktree by default, and follow-ups reuse it. DevHub pins the task
workspace while work is active, then releases its pin when the task is done,
abandoned or deleted (or when a plan moves to implementation). A merge makes
the checkout eligible for review; removal still needs confirmation.
See [API Routes](../reference/api-routes.md).

### Row actions

Each PR row shows the title (links to GitHub), metadata (`repo#number`, author, requested-reviewer facepile), a **Notes** glyph when a review note exists, and a **⋯** menu. Right-click or use the kebab to open the context menu — actions differ by tab:

| Tab | Menu actions |
| --- | ------------ |
| **Mine** (authored) | Open on GitHub · Copy PR URL · Copy Jira URL (when title contains a key) · **Open in Cursor** (stash if dirty, `gh pr checkout`) · **Review with agent** · Copy Slack request · Open review note |
| **Review requested** | **Review with agent** (or **Finish your daily rep first** when that PR is today's unfinished rep) · Open in Cursor · Open on GitHub · Copy URLs · Open note |
| **Recently reviewed** | Copy approved · Copy reviewed · Open in Cursor · Open on GitHub · Copy URLs |
| **Skipped** | PRs you hid with **Skip until updated**. Un-skip to put one back in the queue. |

**Skip until updated** (review-requested rows) hides a PR you don't intend to review yet. It stays hidden until the author pushes or the PR otherwise changes (`updatedAt` moves), then it returns to **Review requested**. Stored in `notes/.config/skipped-prs.json`; API `GET`/`POST`/`DELETE /api/github/prs/skip`.

The reviewer facepile is display-only. There is no dashboard **Request review** action and no `/api/github/prs/reviewers` route — request reviewers on GitHub.

**Open in Cursor** calls `POST /api/github/prs/open-in-cursor` — finds the local clone under the Repos scan directory, stashes dirty work, checks out the PR branch, and launches Cursor. Optional `notePath` opens a notes working copy alongside. MCP parity: `prs_open_in_cursor`. Requires the repo to be cloned locally.

**Review with agent** is intentionally local. It opens the Agents handoff sheet (`launchAgentJob` → `openAgentHandoff`) and starts a Paseo agent with the `pr-explain-review` skill. It does **not** inject into a live shell tab. The skill saves the write-up through notes MCP. It does **not** post comments, approve, or request changes on GitHub unless the human explicitly asks the tool to do that later.

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

- Set up Paseo on **Agents → Connection** (`/agents?view=connection`) so Review with agent can start an agent. See [Agents (Paseo)](../guides/paseo-agents.md).
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
| **Review with agent** shows a setup hint | Start or set up Paseo on **Agents → Connection**. Background defaults still prefer Cursor + Grok (`DEVHUB_AGENT_CLI` / `DEVHUB_AGENT_CURSOR_MODEL`). See [Agents (Paseo)](../guides/paseo-agents.md). |
| Approved tick missing on a reviewed PR | Expected when the repo does not *require* reviews **and** the GraphQL approval lookup failed. The Search API `review:approved` qualifier is not used — it misses those PRs. |
| **Open in Cursor** fails               | The PR's repo is cloned under the Repos scan directory and `cursor` is on `PATH`.                                                                                          |
| Repo card says "changed" with no real edits | Expected for leftover `.DS_Store` / `__pycache__` / `.terraform` — those are noise and no longer increment `dirtyCount`. If you still see a count, the Git workspace Changes list is the source of truth. |
| Repo card says "unpushed" after the PR merged | A gone upstream (`[gone]`) now counts as `0`. If the chip remains, the branch still has a live upstream with commits ahead. |
| Worktrees tab is empty while folders remain | Expected when there is no merged PR and no finished agent run for that path (or the worktree is locked). Check the repo's Git **Worktrees** tab. |
| **Finish your daily rep first**        | Expected when this PR is today's unfinished [daily review rep](../architecture/dashboard.md#daily-review-reps). Save findings on `/review/rep` first.                     |
| **Notes** link never appears          | The agent job finished, the skill had notes MCP access, and it wrote to the exact `Notes MCP path` from the prompt.                                                       |
| Review note landed in the wrong place | `NEXT_PUBLIC_REPO_ROOT` mirrors `REPO_ROOT` in `dashboard/.env.local`; restart DevHub so the agent run can pin `NOTES_DIR`.                                                |
| Standup misses PRs                    | The PR was merged in the selected time window.                                                                                                                           |
