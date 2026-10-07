# Roadmap

Open work only. What's built is in the [docs](docs/README.md); what shipped, and why it was
built that way, is in the git log and the [archive](docs/archive/README.md). What DevHub
deliberately won't do is in [Scope and constraints](docs/contributing/scope.md).

## In progress and proposed

Plans for work that isn't finished. Each lives in [`docs/plans/`](docs/plans/notes-and-learnings.md)
and moves to the archive when it ships.

| Plan | What it fixes |
| ---- | ------------- |
| [Notes and learnings refactor](docs/plans/notes-and-learnings.md) | Notes already have area landing pages and grouped navigation. Renderer consolidation, note metadata, backlinks and a shared index across docs, notes and learnings remain unfinished. |
| [Terminal sessions that survive a rebuild](docs/plans/terminal-session-persistence.md) | A rebuild restarts the PTY peer and kills every parked shell. Moves PTY ownership out of the dev loop. |

## Deliberately deferred

These were costed and put off. Each says what would change the answer.

- **Hosted Google OAuth.** Removes the bring-your-own-credentials step for Google Calendar. It
  costs Google app verification, a permanent callback domain and a privacy policy to save a
  one-time, now well-guided, ten-minute setup. Revisit only if DevHub is shipped to people other
  than its author.
- **Rust sidecars.** Repo scanning with `git2`, terminal transcript search and a `portable-pty`
  PTY server are the candidates, in that order. Only worth doing if measurement shows a hot path
  that justifies it. A full Rust rewrite was costed and rejected; the reasoning is in the
  [archived roadmap](docs/archive/onboarding-and-tauri-roadmap.md).

## Standing quality work

Small, incremental cleanup rather than a project: shared UI primitives, fewer inline styles,
consistent page conventions, better loading and error states, smaller large files, stronger type
boundaries and accessibility polish. See the [quality backlog](docs/reference/backlog.md).

## Proposing something

Write it as a page in `docs/plans/` with a status line, and open a PR. A plan that is still partly
unbuilt when everything around it ships should be split: archive what shipped, keep the rest here.
