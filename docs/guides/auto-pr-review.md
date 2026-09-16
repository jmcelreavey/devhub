---
title: Auto agent-review
description: Poll or trigger Review-with-agent jobs for your review-requested PR queue without posting GitHub review comments.
order: 8
icon: GitPullRequest
tags: [workflow, github, agents]
related:
  - reference/api-routes
  - architecture/mcp-server
  - guides/scheduled-jobs
  - guides/pipeline-investigate
---

# Auto agent-review (P0)

DevHub can start the same **Review with agent** job the PR row context menu starts — for every open PR that requests your review — without posting GitHub review comments.

## Behaviour

- **Source:** review-requested queue from `GET /api/github/prs` (already applies **Skip until updated**).
- **Skips:** drafts; optional repo allowlist misses; PRs whose current head commit was already auto-reviewed (comments, labels and CI don't trigger a re-review — a new push does); PRs whose `pr-reviews/<slug>` note mtime already covers the PR's `updatedAt`; excess rows past the concurrency cap (1–2).
- **Starts:** OpenCode session with `agentReviewPrompt` + note path under `pr-reviews/` (identical to the UI action). The agent writes the note via notes MCP; **nothing is posted to GitHub as a PR review**.
- **Dedupe state:** `notes/.config/auto-pr-reviews.json` (per-URL `headSha`, plus `updatedAt` as a fallback for records written before SHAs were stored).

## Enable / trigger

| Mechanism | How |
| --------- | --- |
| One-shot HTTP | `POST /api/github/prs/auto-review` with `{ "dryRun": true }` or `{ "dryRun": false, "limit": 1, "url"?: "…" }` (same-origin / `DEVHUB_API_SECRET`) |
| GUI one-shot | On `/prs` → **Review requested**, **Review next PR** shows the next PR in a confirm dialog and starts exactly that one. |
| MCP (one-shot) | `prs_auto_review` (dry-run) or `prs_auto_review` with `confirm: true` |
| GUI / API poller toggle | On `/prs` → **Review requested**, pick **Off**, **Work hours** or **Always** in the **Auto-review** bar. Or `GET`/`PUT /api/github/prs/auto-review/settings` with `{ enabled?, always? }`. Persists to `notes/.config/auto-pr-review.json`; takes effect on the next tick (kicked immediately after save). |
| MCP (poller prefs) | `prs_auto_review_settings_get` / `prs_auto_review_settings_set` (`enabled` / `always`) |
| Env bootstrap (until first prefs save) | `DEVHUB_AUTO_PR_REVIEW=1` enables; `DEVHUB_AUTO_PR_REVIEW_ALWAYS=1` skips the weekday window. Once the prefs file exists, prefs win over env for enable/always. Interval / timezone / hours stay env-only: `DEVHUB_AUTO_PR_REVIEW_INTERVAL_MS` (default 15m), `DEVHUB_AUTO_PR_REVIEW_TZ` (default `Europe/London`), hours 9–18. The poller interval always registers at dashboard boot so GUI/MCP can enable without restart. |
| Allowlist (optional) | `DEVHUB_AUTO_PR_REVIEW_REPOS=owner/repo,owner/other` — empty means all repos |
| Concurrency | `DEVHUB_AUTO_PR_REVIEW_CONCURRENCY=1` or `2` (clamped) |

## Out of scope

Auto-posting GitHub review comments, cloud agents, GitHub webhook listeners, Confluence MCP (later milestones).
