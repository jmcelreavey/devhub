---
title: Git client parity audit
description: Point-in-time comparison of the Git workspace against desktop Git clients (regenerated August 2026).
order: 8
icon: Archive
tags: [archive, git]
---

# Git client parity audit

What DevHub's Git workspace does vs what a full desktop Git client (GitKraken Desktop,
Fork, Tower, SourceTree) does.

Method: every `case` in `dashboard/app/api/repos/[name]/{branches,git/*}/route.ts` compared
against the panels in `dashboard/components/repo-git/`, then against GitKraken Desktop's
documented feature set.

Regenerated 2026-08-11. The previous revision (2026-08-05) had gone stale in a way worth
noting: it listed remote branches, the commit context menu, tags, cherry-pick, revert,
the three-way conflict resolver, force-push-with-lease and pagination as gaps, all of
which had shipped in the days after it was written. An audit that argues for finished
work is worse than no audit, so this one records what was checked and when.

**Short answer: close on the daily loop, and parity is still the wrong target.** What
remains missing is mostly deliberate. What was missing and mattered has largely been
closed.

---

## Covered

### Changes

Stage / unstage by file, **by hunk, and by individual line** (click to pick, shift-click
to extend a run), discard, commit, `--amend`, AI-drafted commit messages, commit-and-push
as one action, index-lock recovery, git-hook failure surfacing with the hook's own output,
terminal handoff.

### Remotes

List, add, rename, remove and re-URL. Push and set-upstream can target a chosen remote,
and web links follow the branch's own upstream rather than always `origin` — so a
fork-based workflow (`origin` = your fork, `upstream` = the repo you cannot push to) works
end to end.

### Worktrees

List, add, remove, lock / unlock and prune. Added beside the repository, so DevHub lists
each as a repo of its own — which is what you want when handing one to an agent.

### Branches

List local **and remote**, checkout with auto-stash-and-restore, checkout a remote branch,
create, rename, delete, force delete, fetch (`--all --prune`), pull (`--ff-only`), push
with automatic upstream creation, **force-push-with-lease**, merge into current, rebase
onto, branch-from, set upstream, hard reset to a branch, compare-with-current, copy name,
open PR / branch on the web, and `sync-main` (stash → fetch → merge → push → restore) as a
single button. Backup refs before anything that rewrites a branch pointer.
**Filter box and prefix grouping** over both lists, so `feature/`, `PROJ-` and friends
become navigation rather than sixty flat rows.

### History

Lane-rendered commit graph with ref chips, **author avatars**, **server-side message and
author search across the whole history**, unpushed-only filter, **all-branches / this-branch
scope toggle**, per-commit diff with adjustable context, per-file diff, whole-branch range
compare, undo last commit, reset-and-stash-ahead, fetch / pull / push / sync on the
relation strip, and a **commit context menu** (cherry-pick, revert, tag, checkout detached,
reset to here, branch from here, copy SHA, copy message).

The graph itself was rewritten on 2026-08-11: lane recycling, branch-stable colours, a
fixed palette that survives every theme, pass-through edge rendering, HEAD marking, and
frontier-based pagination. See the commit for why each was wrong before.

### Stash

Save with AI-drafted message, apply, pop, drop, conflict routing.

### Reflog

Every position HEAD has held, with unreachable commits marked and recoverable to a new
branch. Recovery is branch-from-here rather than reset, so rescuing a lost commit cannot
cost you the one you are on.

### Also

Three-way conflict resolution, blame with open-at-revision and hand-off into History,
change-coupling hints, commit context chips, an integrated terminal, PR status on repo
cards, and repos reachable from the command palette.

---

## Gaps

Ordered by how often they'd actually bite.

### 1. No interactive rebase — **deliberate**

GitKraken's signature feature. Explicitly out of scope: a conflict-resolving interactive
rebase is not something a modal can babysit, and the terminal is right there.

### 2. Smaller, but noticeable

- **Pull is `--ff-only` only** — no pull-with-rebase, no pull-with-merge. A diverged
  branch dead-ends with an error message.
- **Reset offers hard only** in the UI, though the server takes `soft` / `mixed` / `hard`.
- **No clone or init** — repos must already exist in the scan directory.
- **No submodules, no LFS, no bisect, no GPG signing UI.**

---

## Recommendation

Parity as such was never the target, and what is left unclosed is now either deliberate
(interactive rebase) or genuinely marginal for a tool whose job is the daily loop.

The remaining list, in rough order of value:

1. **Pull with rebase / merge**, so a diverged branch stops dead-ending.
2. **Soft and mixed reset** in the UI — the server already takes them.
3. **Clone / init**, the only reason to leave the app when starting something new.

None of these is a project. LFS, submodules and bisect stay out: they are a lot of surface
for rare operations, and GitKraken is right there (there's already an `open-gitkraken`
route).
