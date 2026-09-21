---
title: Pipeline investigate
description: Glance CI on PR rows and launch Investigate pipeline (skill + MCP) without posting GitHub reviews.
order: 9
icon: GitPullRequest
tags: [workflow, github, agents, ci]
related:
  - reference/api-routes
  - architecture/mcp-server
  - guides/auto-pr-review
  - guides/skills
---

# Pipeline investigate (P5)

Authored and review-requested PR rows show a **CI glance** glyph (passing / failing / pending) from `GET /api/github/prs` — same visual language as the repo-card open-PR chip. Right-click **Investigate pipeline** (highlighted when failing) starts an agent job with the `devhub-fix-pipeline` skill.

## Behaviour

- **Glance:** check buckets folded into the PR list GraphQL meta query (no per-PR `gh pr view`).
- **Agent:** AionUi conversation with `agentPipelineInvestigatePrompt` + note under `pr-reviews/` (same note family as Review with agent).
- **Skill:** pull PR state + failed checks/logs; classify flake vs real; reproduce locally when practical; fix on branch with **push only on confirm**; write findings to the review note.
- **Never** auto-posts GitHub PR review comments.
- **Optional:** confirm-gated re-run of failed Actions (`rerunFailed`) via the API/MCP.

## Enable / trigger

| Mechanism | How |
| --------- | --- |
| UI | PR row context menu → **Investigate pipeline** |
| One-shot HTTP | `POST /api/github/prs/pipeline-investigate` with `{ "repo", "number", "confirm": true }` (optional `rerunFailed`, `dryRun`) |
| MCP | `prs_pipeline_investigate` (preview) or with `confirm: true` |
| Queue glance | `prs_list` (includes checks) · live wait: `events_wait` (`kind: "pr"`, `until: "checks_done"`) · detail: `GET /api/github/pr-state` |

## Out of scope

Auto-posting GitHub reviews, Confluence MCP, CI green/backport finale.
