---
name: devhub-fork-workflow
description: Use when contributing a DevHub feature from a private mirror back to the public core (backport / push upstream) or pulling core updates down from upstream into the mirror. Covers generic-vs-personal judgement, base selection, leak scanning, and the --mark-synced step after a backport. Trigger phrases — "backport this", "push this upstream", "contribute to public devhub", "pull core updates", "sync from upstream".
metadata:
  short-description: Push/pull features with the public DevHub core
---

# DevHub Fork Workflow

## Overview

A DevHub mirror is a private working copy with the shared public core wired in as the
`upstream` remote. The public core has an **unrelated git history** (it's seeded from a
clean tree so private history never leaks), so you can never rebase/merge across the two —
both directions port *content diffs* via `git apply --3way`.

Two scripts do the mechanics; this skill is the judgement around them:

- `scripts/devhub-backport.sh` — push a generic feature up to the public core (opens a PR).
- `scripts/devhub-update.sh` — pull core updates down into the mirror.

**Never automate the push direction.** A backport opens a public, effectively irreversible
PR — always preview, eyeball the diff, and let CI run.

## When To Use

- The user wants to share a feature they built in the mirror with the public core.
- The user wants to pull new core changes from upstream into their mirror.
- The user asks why an update "rebase" fails (answer: unrelated history — use the script).

## Preconditions (check first)

```bash
git remote get-url upstream            # must exist; if not, add the public core
git branch --show-current              # update.sh requires main/master
git status --porcelain --untracked-files=no -- . ':!notes' ':!tasks' ':!collections'  # non-personal must be clean
```

The update script blocks only on **non-personal** tracked changes. Live-dirty `tasks/`,
`notes/`, and `collections/` are ignored — you do not need to stash them before pulling.

## Pushing a feature upstream (backport)

1. **Judge generic vs personal.** Only genuinely reusable, non-company, non-personal
   features belong in public. Company/private logic stays in a plugin (see
   `docs/architecture/plugins.md`); personal data (`notes/`, `tasks/`, `collections/`,
   `persona/identity.txt`, `.env.local`) is auto-excluded but should never be the point of
   the PR. If in doubt, it doesn't go to public.

2. **Pick the source ref and base.** The script ports `BASE..SOURCE_REF`. `--base` defaults
   to `SOURCE_REF^` (correct for a single tip commit). For a multi-commit feature, pass the
   branch point: `--base <branch-point>`.

3. **Preview first** (default — no `--execute`):

   ```bash
   bash scripts/devhub-backport.sh <source-ref> [--base <ref>] [--title "…"]
   ```

   It branches off `upstream/<default>`, applies the feature's hunks (3-way, so public-side
   templatisation survives), runs the **leak scan on added lines**, and prints the diff
   stat. Confirm the file list is only the intended feature — no personal/strategy paths.

4. **Execute** once the preview is clean:

   ```bash
   bash scripts/devhub-backport.sh <source-ref> [--base <ref>] --title "…" --execute
   ```

   This pushes the branch to `upstream` (the public repo — the private mirror can't be a PR
   head for it) and opens the PR. The pre-push hook re-runs full verify + leak scan.

5. **After it merges, advance the sync marker** — your mirror already contains what you
   just sent public, so do **not** pull it back:

   ```bash
   bash scripts/devhub-update.sh --mark-synced
   ```

## Pulling core updates (update)

> From the dashboard, the **Actions** page exposes **Pull Core Updates (Preview)** (read-only)
> and **Pull Core Updates** (apply) — they wrap the same script. Use the CLI below when
> driving headless or scripting.

```bash
# First run only: tell it the upstream commit your mirror last matched.
bash scripts/devhub-update.sh --since <upstream-ref>

bash scripts/devhub-update.sh --dry-run   # preview incoming commits + diff stat
bash scripts/devhub-update.sh             # apply, commit, validate, re-sync assets
```

It tracks the last pull in the git ref `refs/devhub/upstream-sync`, so after the first
`--since` it's automatic. It ports only commits the mirror lacks. If a hunk conflicts with
your mirror customisation it aborts before committing, rolls back only upstream patch
files (personal paths keep their dirty state), and prints manual-resolve steps — see
`docs/guides/fork-workflow.md`.

> Caveat: don't run a full pull for changes that **originated in your mirror** and went up
> via backport — they're already present, and re-applying is messy. Use `--mark-synced`
> for that case (see step 5 above).

## Rules

- Preview (no `--execute`) before every backport; read the diff stat.
- Commit or stash non-personal changes before pulling; personal `tasks/`/`notes/`/`collections/` dirt is fine.
- The leak scan is the safety net, not a substitute for judgement — keep company names and
  private logic in plugins, not in backported core.
- One concern per PR; let CI go green before merging.

## Verification

- Backport preview prints the file list + "Leak scan passed" — confirm both before `--execute`.
- After a real pull, the script runs `validate` + `sync`; confirm they pass.
- Reference: `CONTRIBUTING.md`, `docs/reference/scripts.md`.
