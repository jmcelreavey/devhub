---
name: devhub-sync
description: Use when cleaning and syncing DevHub, DevHub-Private, and DevHub-BI repos: fetch/prune branches, commit and push private/plugin work, pull public core updates into the private mirror, and backport generic private changes to public DevHub either by PR or direct main push when explicitly permitted.
metadata:
  short-description: Sync DevHub public/private/plugin repos
---

# DevHub Sync

## Scope

Use this for the three-repo maintenance loop:

- `~/Developer/devhub` — public/core DevHub.
- `~/Developer/devhub-private` — private mirror with `upstream` pointing at public/core.
- `~/Developer/devhub-bi` — BI plugin source repo.

The goal is usually: clean local branches, push private/plugin work, pull latest public core into the private mirror, then send generic private changes back to public core without notes, tasks, collections, identity, or env-local data.

## First Question

Ask once before the public push direction:

```text
For public DevHub changes, do you want a PR or a direct push to main?
```

Default to PR. Direct `main` push is allowed only when the user explicitly chooses it and the remote accepts it. If direct push is blocked, fall back to a branch and tell the user.

## Workflow

1. Fetch and prune all three repos.

```bash
git -C ~/Developer/devhub fetch --all --prune
git -C ~/Developer/devhub-private fetch --all --prune
git -C ~/Developer/devhub-bi fetch --all --prune
```

2. Inspect status, remotes, branches, and ahead/behind counts before editing.

```bash
git -C <repo> status --short --branch
git -C <repo> remote -v
git -C <repo> branch -vv
```

3. In `devhub-private`, resolve staged/unstaged weirdness before committing. If a tracked file is both deleted and untracked, decide which copy is real from the working tree, then unstage accidental rollbacks with `git restore --staged .` rather than rewriting file contents.

4. Commit and push private-only state to `origin/main`. Personal data is expected in `devhub-private`; do not push it to public/core.

```bash
git -C ~/Developer/devhub-private add -A
git -C ~/Developer/devhub-private commit -m "chore: devhub private sync YYYY-MM-DD"
git -C ~/Developer/devhub-private push origin main
```

5. Commit and push BI plugin work in `devhub-bi` to its default branch (`master` today unless the repo has moved to `main`). Then materialize into private/core only if verifying dashboard integration.

```bash
git -C ~/Developer/devhub-bi add -A
git -C ~/Developer/devhub-bi commit -m "feat: <short plugin change>"
git -C ~/Developer/devhub-bi push origin HEAD
```

6. Pull public core updates into the private mirror using the mirror script, never merge/rebase histories.

```bash
bash ~/Developer/devhub-private/scripts/devhub-update.sh --dry-run
bash ~/Developer/devhub-private/scripts/devhub-update.sh
git -C ~/Developer/devhub-private push origin main
```

If `devhub-update.sh` blocks on dirty non-personal paths, commit or stash those paths first. Do not force it.

7. Backport only generic private changes to public/core. Exclude personal/private paths:

```text
notes/
tasks/
collections/
dashboard/.env.local
persona/identity.txt
TEMPLATE_AND_PLUGIN_PLAN.md
scripts/make-public-seed.sh
```

Preferred PR path:

```bash
bash ~/Developer/devhub-private/scripts/devhub-backport.sh <source-ref> --base <base-ref> --title "<title>"
bash ~/Developer/devhub-private/scripts/devhub-backport.sh <source-ref> --base <base-ref> --title "<title>" --execute
```

Direct-main path, only after the user chose it:

- Build/inspect the same clean patch preview first.
- Apply the previewed public-safe diff onto `~/Developer/devhub` `main`.
- Run the leak scan and targeted tests.
- Commit and push `origin main`.

8. After public/core contains the backported changes, mark the private mirror synced instead of re-applying its own changes.

```bash
bash ~/Developer/devhub-private/scripts/devhub-update.sh --mark-synced
git -C ~/Developer/devhub-private push origin main
```

9. Clean local branches only after their work is merged/pushed. Delete local stale branches with `git branch -d <branch>`; use `-D` only when the user explicitly says to throw away the branch.

## Verification

- Run the smallest relevant checks for changed code: targeted `vitest`, `typecheck`, or `validate` before pushing public/core.
- For plugin changes, verify from a DevHub checkout after `sync_plugins`; the plugin repo does not build standalone.
- Run `scripts/scan-leaks.sh` on public/core staged changes before any direct main push.

## Rules

- Never merge/rebase public and private histories; they are intentionally unrelated.
- Never push personal paths to public/core.
- Do not create a PR if the user chose direct main and direct push succeeds.
- If direct push fails, stop and report the branch/commit to open as a PR.
