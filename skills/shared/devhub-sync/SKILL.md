---
name: devhub-sync
description: Sync DevHub public, private, and plugin repositories safely.
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

3. In `devhub-private`, resolve staged/unstaged weirdness before committing. If a tracked file is both deleted and untracked, decide which copy is real from the working tree, then unstage accidental rollbacks with `git restore --staged .` rather than rewriting file contents. Stash or commit tracked `notes/` dirt before `devhub-backport.sh` (it refuses any tracked dirty tree).

4. Commit and push private-only state to `origin/main`. Personal data is expected in `devhub-private`; do not push it to public/core.

```bash
git -C ~/Developer/devhub-private add -A -- . ':(exclude).devhub'
git -C ~/Developer/devhub-private commit -m "chore: devhub private sync YYYY-MM-DD"
git -C ~/Developer/devhub-private push origin main
```

5. Commit and push BI plugin work in `devhub-bi` to its default branch (`master` today unless the repo has moved to `main`). Then materialize into private/core only if verifying dashboard integration. Skip this step when the backlog has no BI plugin changes and `devhub-bi` is clean/even with origin.

```bash
git -C ~/Developer/devhub-bi add -A -- . ':(exclude).devhub'
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
.devhub/
dashboard/.env.local
persona/identity.txt
TEMPLATE_AND_PLUGIN_PLAN.md
scripts/make-public-seed.sh
```

### Prefer `devhub-backport.sh` for a named feature range

```bash
bash scripts/devhub-backport-status.sh
bash scripts/devhub-backport.sh <source-ref> --base <base-ref> --title "<title>"
# PR path:
bash scripts/devhub-backport.sh <source-ref> --base <base-ref> --title "<title>" --execute
```

### When watermark ranges conflict (partial earlier backports)

`devhub-backport.sh` diffs `BASE..SOURCE` and applies onto `upstream/main`. If public already has overlapping hunks from earlier backports, that apply fails with conflicts even though content still differs.

Then use a **tree catch-up** from private (do not use a dirty `~/Developer/devhub` checkout):

```bash
cd ~/Developer/devhub-private
source scripts/lib/public-paths.sh
git fetch upstream
git branch -f backport/catchup upstream/main
git checkout backport/catchup
# reset skip-worktree baselines the same way backport.sh does, then:
git diff --binary upstream/main main -- "${PUBLIC_PATHS[@]}" | git apply --index --3way
git diff --cached -U0 | grep -E '^\+' | grep -vE '^\+\+\+' | bash scripts/scan-leaks.sh stdin
git commit -m "chore: sync public catalog from private"
# Prefer pushing via private's upstream remote (avoids dirty public local checkout):
rm -rf dashboard/.next dashboard/.next-verify   # stale Next types break pre-push typecheck
DEVHUB_SKIP_VERIFY=1 git push upstream HEAD:main   # leak scan already passed; public GHA verifies
git checkout main
bash scripts/devhub-backport-status.sh --set-watermark
bash scripts/devhub-update.sh --mark-synced
```

Path-subset batches (e.g. skills-only then dashboard) are fine for review, but each batch must leave public typecheck-consistent — skills-only while private `.next` caches still reference Agents routes will fail the private pre-push verify. Prefer one coherent catch-up commit, or clean `.next` / use `DEVHUB_SKIP_VERIFY=1` after a green leak scan when pushing to `upstream`.

### Direct-main path (user chose direct)

- Prefer `git push upstream <backport-branch>:main` from private after a successful preview/catch-up commit.
- Do not require a clean `~/Developer/devhub` working tree.
- Always leak-scan added lines before push.
- Close obsolete open backport PRs that the catch-up supersedes.

### PR path (default)

Use `--execute` on `devhub-backport.sh` so it pushes the backport branch and opens the PR.

8. After public/core contains the backported changes, mark the private mirror synced instead of re-applying its own changes.

```bash
bash ~/Developer/devhub-private/scripts/devhub-update.sh --mark-synced
bash ~/Developer/devhub-private/scripts/devhub-backport-status.sh --set-watermark
```

(`--mark-synced` advances `refs/devhub/upstream-sync`; `--set-watermark` advances `.git/devhub-backport-watermark`. Both are local git state — neither needs a private commit unless you also push other changes.)

9. Clean local branches only after their work is merged/pushed. Delete local stale branches with `git branch -d <branch>`; use `-D` only when the user explicitly says to throw away the branch.

## Verification

- Leak-scan public-safe added lines before any public push (`scripts/scan-leaks.sh`).
- Private pre-push runs full dashboard verify on every `git push`, including pushes to `upstream`. Stale `dashboard/.next*` from private main will fail typecheck on a catch-up branch; clear those caches or set `DEVHUB_SKIP_VERIFY=1` only after leak scan passed, and rely on public GitHub Actions Verify.
- For plugin changes, verify from a DevHub checkout after `sync_plugins`; the plugin repo does not build standalone.

## Rules

- Never stage or commit `.devhub/` in any repo. Before every commit, check `git diff --cached --name-only`; if `.devhub/` appears, unstage it with `git restore --staged -- .devhub`.
- Never merge/rebase public and private histories; they are intentionally unrelated.
- Never push personal paths to public/core.
- Do not create a PR if the user chose direct main and direct push succeeds.
- If direct push fails, stop and report the branch/commit to open as a PR.
- Run this work on the Mac checkout with Shell `machineId` — box executors cannot see `/Users/jmcelreavey/...` or push with Mac `gh`/SSH.
