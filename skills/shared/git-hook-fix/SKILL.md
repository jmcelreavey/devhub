---
name: git-hook-fix
description: >-
  Fix a failing git hook (pre-commit, commit-msg, pre-push, husky, verify/lint).
  Inspect the failure log, fix the underlying errors, and re-run the hook or
  the original git command until it passes. Use when DevHub hands off a hook
  failure, or when the user asks to fix a blocked commit/push. Never skip
  hooks with --no-verify or DEVHUB_SKIP_VERIFY unless the user explicitly asks.
metadata:
  short-description: Fix failing git hooks (commit/push)
---

# Git Hook Fix

## Overview

A git hook blocked commit or push (often `pre-push` → `npm run verify`, or
`pre-commit` / `commit-msg`). Fix the real errors so the hook passes. Do not
bypass hooks unless the user explicitly asks.

## When To Use

- DevHub "Resolve with AI" after a hook failure.
- User says commit/push was blocked by a hook, husky, lint-staged, or verify.
- Failure output lives in `.git/devhub-hook-failure.log` or was pasted in-chat.

## Steps

1. Read `.git/devhub-hook-failure.log` if present; otherwise re-run the failing
   command (`git push`, `git commit`, or the hook script) to reproduce.
2. Identify the failing hook (`pre-push`, `pre-commit`, `commit-msg`, …) and
   the underlying check (lint, typecheck, tests, leak scan, commitlint).
3. Fix the errors with minimal diffs. Prefer real fixes over silencing rules.
4. Re-run the same check the hook runs (e.g. `npm run verify` from the
   dashboard dir, or the repo's pre-push script) until it passes.
5. Do **not** commit or push unless the user asks. Do **not** use
   `--no-verify`, `HUSKY=0`, or `DEVHUB_SKIP_VERIFY=1` unless explicitly asked.
6. Finish with a short summary: what failed, what you fixed, and the next
   command (`git commit` / `git push`).

## Constraints

- Stay in the repo cwd you were launched in.
- Keep the prompt loop interactive — ask when intent is unclear.
- Never force-push or rewrite published history.
