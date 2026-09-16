---
name: git-conflict-resolve
description: Resolve Git merge or stash conflicts in the working tree.
metadata:
  short-description: Resolve git stash/merge conflicts
---

# Git Conflict Resolve

## Overview

The working tree has unresolved conflicts (usually after `git stash pop` on
branch switch, or a merge/rebase). Resolve them so `git status` is clean of
unmerged paths. Leave the commit decision to the user.

## When To Use

- DevHub hands off after a stash pop conflicted on branch switch / stash apply.
- The user asks to resolve merge, rebase, or stash conflicts.
- `git status` shows unmerged paths (`UU`, `AA`, …) or files contain `<<<<<<<`.

## Steps

1. Run `git status` and list unmerged / conflicted files.
2. For each file, read the conflicted content and decide the correct merge:
   - Prefer keeping both sides' intent when both are valid.
   - Prefer the branch the user switched *to* when the stash is just WIP noise —
     but do not silently drop real work from the stash.
   - For delete/modify conflicts, confirm with `git status` / `git ls-files -u`.
3. Write the resolved file **without** conflict markers (`<<<<<<<`, `=======`,
   `>>>>>>>`).
4. `git add` each resolved file.
5. Do **not** `git stash drop` unless the stash entry is clearly already applied
   and the user asks — after a failed `stash pop`, git usually keeps the stash.
6. Do **not** commit unless the user explicitly asks.
7. Finish with a short summary: files resolved, remaining issues, suggested next
   step (`git status`, commit, or re-apply stash).

## Constraints

- Stay in the repo cwd you were launched in.
- Prefer small, correct edits over rewriting whole files.
- If a conflict is ambiguous (business logic, unclear intent), stop and ask
  rather than guessing.
- Never force-push or rewrite published history.
