---
name: devhub-fix-pipeline
description: Investigate failing or flaky CI checks on a GitHub PR, classify root cause, and fix on confirm.
metadata:
  short-description: Investigate PR CI / pipeline failures
---

# DevHub Fix Pipeline

## Overview

Given a GitHub PR (URL or `owner/repo#number`), dig into its CI/checks:

1. **Collect** PR state + failed check names/logs.
2. **Classify** flake vs real failure (with evidence).
3. **Reproduce** locally when practical.
4. **Fix** on the PR branch — **push only after explicit confirm**.
5. **Write findings** to the DevHub PR review note (never auto-post a GitHub review).

## When To Use

- Dashboard **Investigate pipeline** on an authored or review-requested PR row.
- MCP `prs_pipeline_investigate`.
- User asks to dig into a red / pending build on a PR.

## Inputs

Accept a full PR URL or `owner/repo#123`. `gh` must be authenticated. When a notes path is supplied, append/write findings there via notes MCP.

## Workflow

### 1. Snapshot PR + checks

Prefer DevHub MCP when available:

- `prs_list` — glanceable `checks` / counts on authored + review queues.
- Live detail: dashboard `GET /api/github/pr-state?repo=owner/name&number=N` (or `events_wait` with `kind: "pr"` / `until: "checks_done"` while waiting).

Otherwise use `gh`:

```bash
gh pr view <url> --json title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup,commits
gh pr checks <url>
```

For failed jobs, pull logs (`gh run view <id> --log-failed` or the check's details URL). Cap log paste — quote the failing assertion / error line, not megabytes.

### 2. Classify flake vs real

| Signal | Likely flake | Likely real |
| ------ | ------------ | ----------- |
| Same test fails every re-run | | ✓ |
| Passes on re-run / unrelated to diff | ✓ | |
| Assertion matches recent code change | | ✓ |
| Infra / runner / network timeout only | ✓ (or env) | |
| Typecheck / lint / compile error | | ✓ |

State the classification in one line with the evidence. If unsure, say so and list the next probe.

### 3. Reproduce locally when practical

Checkout the PR branch in the local clone (`prs_open_in_cursor` / `gh pr checkout`) only when reproduction needs the tree. Run the smallest command that surfaces the failure. Skip heavy e2e matrices unless the user asks.

### 4. Fix — push only on confirm

- Commit locally on the PR branch when you have a fix.
- **Do not push** until the user confirms (or MCP/`confirm: true` for a push tool).
- Prefer minimal diffs. Do not "fix" flakes by skipping tests without saying so.

Optional: confirm-gated re-run of failed Actions (`gh run rerun <id> --failed`) after a push or when investigating flake — never re-run silently in a loop.

### 5. Write findings to the review note

Use notes MCP (`notes_write` / `notes_append`) on the supplied path (typically `pr-reviews/<repo>-<n>`). Structure:

```markdown
## Pipeline investigate

- **Verdict:** flake | real | unclear
- **Failed checks:** …
- **Evidence:** …
- **Repro:** … (or "not reproduced")
- **Fix:** … (or "none yet") / push status
```

Do **not** post GitHub PR review comments unless the user explicitly asks.

## Combo with other tools

- Wait for green: `events_wait` (`kind: "pr"`, `until: "checks_done"`).
- After a fix lands: re-check with `pr-state` / `prs_list` glance fields.
