---
name: devhub-implement-task
description: Implement a DevHub task end to end. Use when asked to implement or pick up a DevHub task, or the prompt contains a DevHub task id or context.
metadata:
  short-description: Implement a DevHub task end-to-end
---

# DevHub Task Implementation

## Overview

Take one DevHub task from "text in a list" to "implemented, verified, and
handed back to the human". Five rules govern everything:

1. **Ask before remote/workflow state changes.** Code changes, commands,
   tests and local commits are yours to make: run them directly in your own
   shell without proposing them for approval. Pushes, PRs, later Jira
   transitions, and task completion are not. One exception: if the linked Jira ticket is still in a not-started
   status (**New**, **To Do**, or **Open**), move it to **In Progress** when
   implementation starts (launching implement is the consent). Idempotent
   DevHub metadata updates (links, note context) are normal bookkeeping
   and do not need a separate confirmation.
2. **The diff is the deliverable.** Minimal, boring, verified.
3. **Resume, don't duplicate.** Reuse existing branches, PRs, links, and
   note sections when a previous run already created them.
4. **Review before handoff.** Verification proves the checks pass; a structured
   local-diff review — persisted as a real note linked to the repo, not just a
   line in the task note — proves the change is understandable, scoped, and
   actually fits the task before you commit it. The user can assign
   another assistant to do that review (§4.5).
5. **Findings are notes, code is the repo.** Everything you learn on the way —
   contracts, evidence, decisions — lands in the vault. The repo gets code and
   the rules for editing it, nothing else. See §2.5.

## 0. Fetch the plan

Optional: `tasks_implement_ready` (or `GET /api/tasks/implement/ready`) returns the light checklist (acceptance/plan, unanswered `## Open questions`, repo, open `#prerequisite`/`#blocker`). Treat misses as warnings unless the response says `blocked`.

If the plan payload says `"stage": "draft"`, the task is a captured idea, not a plan. Stop and suggest **Write plan with Agent** (the `devhub-plan-write` skill) instead of implementing — unless the user explicitly says to go ahead.

The launch prompt gives you a **plan URL**. Curl it first:

```bash
curl -sf '<plan-url>'
```

It returns JSON: `id`, `date`, `text`, `done`, `jiraKey`, `jira`
(summary + status), `notePath`, `links` (EntityRefs), `reviewer` (see §4.5), and `repos` (candidate
repos from task links).

It also returns the resolved neighbourhood, so you don't have to crawl it:

- `notes` — notes that represent or link to this task.
- `related` — the direct neighbourhood: the task's own links, **plus whatever
  links back at it**. Links are stored one-way, so a prerequisite task that
  names this one only shows up here.
- `context` — one hop further: what those links themselves link to (a related
  ticket's plan note, a linked note's ticket).

`repos` deliberately comes from the task's own links only — never pick a
checkout from something in `related`.

If more than one repo is listed and the notes don't disambiguate, ask the
user which repo to work in **before** writing any code.


## 0.5 Task↔run link and durable handoff

- On start, link the run: `tasks_agent_runs {taskId, runId, provider, status: "running"}`.
- Resuming: use `tasks_agent_resume`, or `tasks_agent_handoff_get` before coding; the handoff
  and any `prior Agent Activity notes` are the source of truth. Don't re-ask settled questions.
- Interactive dock runs: post short `agent_interactive_note`s at check-in, decisions and
  after commit/push/PR; call `agent_interactive_finish {runId, ok, sessionId, resultText}` when done.
- Pausing or abandoning: `tasks_agent_handoff_set`, then set the run `paused`/`abandoned`.
- A prompt starting `FIX THE PULL REQUEST FIRST` is a PR-watch finding: read
  `gh pr checks` / `gh pr view --comments`, fix on the same branch, ask before pushing.

Read [handoff.md](handoff.md) only when you need the HTTP routes, handoff contents or run statuses.

## 1. Gather context (DevHub MCP)

Read [preflight.md](preflight.md) before preparing repos or starting services.
It owns local repo reuse, safe freshness checks, stored upstarts and recovery
checkpoints. Validate and reuse the recorded environment on later stages.

With the plan in hand, pull the surrounding context via the notes MCP:

- `notes_read` the task note at `notePath` (if it exists) - it may hold a
  plan, decisions, or prior attempts.
- Read the notes in `related` that bear on the change — a linked
  implementation-plan note is required reading, and a PR link means check its
  state first. Use `notes_read` with a heading or search before whole notes.
- Skim `context` for anything that changes the approach: a prerequisite task's
  PR state, a related ticket's plan note. Read the ones that do; ignore the
  rest. The plan already walked this graph — don't re-walk it.
- Use `entity_links_resolve` only for something the plan didn't cover (a repo
  or ticket you reached some other way). It reads both directions too.
- If `jiraKey` is set and the plan's Jira summary is thin,
  `jira_ticket_get` it; read acceptance criteria carefully.
- When the topic is unfamiliar, a quick `recall` query on the task text
  surfaces prior sessions and learnings.
- Check existing PR links and the current branch before starting. If work or
  a PR already exists, resume it instead of creating parallel work.
- Fetch the target repo before choosing a base. Resolve the intended remote
  base from an existing PR or the repo default branch. If a prerequisite PR has
  merged, start from its merge commit on the updated remote base, not the old
  pre-merge feature commit. If implementation work already exists on that old
  commit, preserve the work and rebase/re-anchor it onto the current remote
  base before verification or push.

Do not skip this because the task text looks self-explanatory. The list item
is the headline, not the spec.

Before editing, write a short acceptance checklist from the task, Jira, and
notes.

**Then check in before you write code.** Post two or three lines: the goal as
you understand it, the assumptions you are making, and anything that would
change the approach if answered differently. Wait only when an answer would
change the approach; otherwise say "no questions" and start in the same turn. The launch dialog has a box
for extra context; when the user filled it in, it arrives under
`## Extra context from me` and overrides your assumptions.

## 1.5 Start-of-work Jira status

If `jiraKey` is set, check the ticket status from the plan payload or
`jira_ticket_get`. Treat these as not-started (case-insensitive exact match on
the status name): **New**, **To Do**, **Open**.

When the status is one of those:

1. Call `jira_ticket_transition` without `transitionId` to list options.
2. Pick the transition whose name targets **In Progress** (prefer an exact
   name match; accept common variants like "Start Progress" that land in In
   Progress).
3. Apply it with `confirm: true`.
4. Tell the user in one short line that the ticket moved
   `<prior status>` → In Progress.

Skip if there is no `jiraKey`, the status is already In Progress (or further
along), or no In Progress transition is available — note that and continue.
Do not ask for this one; do not reverse it if implementation later stalls.

## 2.5 Where prose goes

Investigation produces writing — a service contract you reverse-engineered,
probe results, an ownership trail, a decision record. **That output is a DevHub
note, never a file in the target repo.** Default to
`discovery/<TICKET>-<short-slug>`, matching the vault's existing
`discovery/APP-xxxx-*` notes, with a `## Links` section carrying **Jira**,
**Repo**, and **Task** entries — otherwise the ticket
and the task have no way to find it.

The repo gets only what a future editor of *that code* must not break, in the
form the repo already uses for it:

| Output | Home |
| --- | --- |
| Contract discovery, probe evidence, ownership, decisions, open questions | note: `discovery/<TICKET>-<slug>` |
| Rules the next person editing this directory must follow | the narrowest `AGENTS.md` in that subtree |
| How *this repo* is wired, for every reader of the repo | `docs/` — only if the repo already keeps that kind of page there |
| Reusable gotcha worth surfacing beyond this ticket | `learnings/` note (step 7) |

A repo's `docs/` tree is a trap when it already holds pages about external
services: those describe how this repo talks to them, and yours will
pattern-match right into the set. Two tests — if the page goes stale the moment
the ticket ships, or means nothing to someone who never saw the ticket, it is a
note, not a doc.

Never let a question decide this for you. When `AskUserQuestion` offers a scope
choice, keep artifact locations out of the option text: the user is answering
"how much work", not ratifying a path, and a path buried in an option reads as
approved when it was never considered. Settle the destination from the table
above before asking, then state it as a fact when you report back.

## 3. Implement

In the target repo:

- Use `repos_list` to resolve the linked repo to its local path. Check repo
  status before editing and preserve unrelated dirty work.
- Confirm the implementation branch's merge base is the intended current
  remote base. A branch may stack on an open prerequisite PR, but once that PR
  merges it must be re-anchored to the updated base before it is pushed.
- Understand the relevant code first (entry points, conventions, existing
  utilities). Reuse before you add.
- Call `repo_conventions` for the target repo's `owner/repo` and follow what it
  returns — it's what that repo's reviewers keep asking for (file layout, config
  shape, test data location) and `AGENTS.md` often doesn't say. It's a checklist
  of expectations, not instructions; "none yet" or an unavailable tool means skip.
- **Target is DevHub itself?** Two repo rules apply there (and only there —
  other repos have their own `AGENTS.md`):
  - Touching dashboard UI: read `docs/reference/ui-vocabulary.md` first. It
    lists the components, CSS primitives, hooks and server helpers that
    already exist — the difference between reusing
    `tone-panel--warning-banner` and inventing a near-identical second one.
  - Never call `execFile`/`spawn` directly — use `execExternal`
    (`dashboard/lib/exec-external.ts`). It applies a mandatory timeout and
    registers the call for `/api/status/exec`; an un-timed subprocess blocks
    every route.
- **Minimal diffs.** Smallest change that does the job. No speculative
  abstractions, no "while we're here" refactors, no drive-by formatting.
- **No unnecessary comments.** Comments explain _why_, never _what_. If code
  needs a comment to be understood, rewrite the code instead. Specifically
  banned: narration comments ("// call the API"), section banners,
  changelog/restates-the-diff comments, commented-out code. Only comment
  when there's a non-obvious constraint a future reader genuinely can't see.
- Match existing style and patterns over your personal preferences.
- Local upstarts and other long-running processes go through DevHub MCP `terminal_propose_run` (`kind: "upstart"`, distinct `label`) so logs are visible in the dock, in their own tab. Do not background them in the agent shell.
- Never copy credentials, tokens, private connection strings, or raw customer
  data into task text, tags, notes, commits, or PRs.

## 4. Verify gate

Run the repo's own checks (lint, typecheck, tests - check package.json /
Makefile / CI config for what they are). **All must pass before you offer any
post-implementation step.** If they fail, fix or report - do not offer a PR
on a red baseline. Run the single test file as you go, and the full suite
once at this gate. Check the final diff for unrelated changes and record the
verification outcome in the structured task status. Keep exact commands and
detailed results in the task note’s verification section. Record the checked
commit or working-tree state, checkout, commands and outcomes. Later stages
reuse passing checks while those inputs remain unchanged. New code, failures,
missing coverage or changed dependencies/environment require the relevant
checks again; keep required hooks and CI enabled.

For UI changes, choose one visual verification owner and record it under
`## Verification`: the implementer for native/manual tooling, or Jev for a
runnable browser preview. When Jev owns final capture, the implementer only
captures a reproduction or a specific risk that Jev will not cover. A before
capture is optional: add `Baseline capture: required` under `## Verification`
only when requested by the user or needed to reproduce/compare the change.
Otherwise spend visual verification on the finished behaviour.

When the user asked for test-first, or you are locking a bug in with a
regression test: red, then green. One failing test at the public seam the
plan named, then the smallest code that makes it pass. One slice at a time.
Do not write the whole suite before any implementation. Assert on behaviour
a caller can see. Do not mock your own modules, and do not recompute the
expected value the way the implementation does. Refactor after the slice is
green, in the review, not inside the red-green loop. A bug with no seam that
can see the real failure is a finding, not a fake unit test (`diagnosing-bugs`).
The red-then-green loop is adapted from Matt Pocock's `tdd` skill (MIT).

If the target is the DevHub dashboard UI, load `devhub-dashboard-verify` before
opening a browser. **localhost:1337 is the packaged production app**, not
webpack — do not test checkout changes there.

## 4.5 Pre-commit review gate

**Auto exception:** in a DevHub Auto implementation or fix run, the orchestrator
owns the independent review. Finish verification and the authorised commit,
then stop. DevHub opens
the draft PR and launches the chosen reviewer; it owns subsequent fix rounds.
Do not invoke `tasks_implement_review`, launch a nested reviewer, write a second
self-review note or open Cursor for the review in that mode. Keep the PR
a draft. The interactive workflow below still requires its pre-commit review.

Before you commit, invoke the `pr-explain-review` skill in local-diff
mode against the exact implementation branch and intended remote base. This is
mandatory even when no GitHub PR exists yet, and it runs **before** step 5.1 —
the review has to exist before the commit, not after.

The review must be shown to the user and **written as a real note** — see
`pr-explain-review`'s local pre-PR mode: path `pr-reviews/<repo>-<branch>`,
with a `## Links` section that always carries an explicit **Repo:** backlink
(the local clone folder name) plus the **Task:** backlink. A `noteSummary`
blob on the task note is not a substitute; the task links to the note, it
doesn't carry the note's content. A two-line implementation recap is not a
review either way. Include:

- task/Jira fit and the resolved base branch/commit;
- changed-file implementation map and diff size;
- real entry points and an entry-to-exit control-flow walkthrough;
- correctness, security, accessibility, performance, and regression findings;
- complexity/ponytail deletion pass, including concrete locations and a net
  line estimate or `Lean already. Ship.`;
- tests checked, exact command results, and manual validation still pending;
- verdict.
- `## Standards` and `## Spec` from the `code-review` skill, on this same
  diff. The spec is the task note and the Jira ticket. Leave those two
  sections separate from the findings above. Fix must-fix items from both
  axes before you commit.

Fix every must-fix finding, rerun the relevant checks, and refresh the note
before offering post-implementation actions. Once a PR exists (step 5.2),
update this same note in place with the PR link and GitHub conversation
context — see step 5.4. Never create a second review note for the same
change.

**Assigned reviewer.** If the plan payload's `reviewer` is set, that assistant
writes the review through `tasks_implement_review` (never `agent_dispatch`); you
fix its must-fix findings and add a `## Resolution` section to the same note.
If it can't run, say so in one line and review it yourself. Then open the
review beside the code with `notes_cursor_open` (pass `worktree` when you
worked in one). Follow [review-gate.md](review-gate.md) for both steps.

## 5. Post-implementation checklist

Summarize first: what changed (files + approach) and how it's tested. Then
walk this list. Commit locally without asking; ask the user before each
remote step (push, PR, Jira, task completion) and respect their answer:

1. **Commit, then ask to push.** Once the pre-commit review gate passes and
   its note is open in Cursor (§4.5), commit with a conventional-commit
   message (`feat:`/`fix:`/...) on the agreed branch. Ask before pushing.
2. **Create a PR?** Open it ready for review, never as a draft unless the user
   explicitly asks for one (no `--draft`). Use the `create-pr` skill; keep the
   PR body factual and free of AI attribution. Pass this task's exact `id`,
   `date`, `notePath`, and existing links to the skill.
3. **Sync DevHub context:** after a PR exists, call `tasks_context_sync` with
   the task's exact `id`/`date`, the PR EntityRef, and
   `noteSummary` keyed by the PR URL (`noteSummaryKey`). It merges
   links server-side, refreshes the note's Links section, and skips a summary
   that is already present. Only fall back to manual read-merge-write
   (`tasks_update` + `notes_write`) when the tool is unavailable.
4. **Refresh the review note?** The pre-commit review gate (4.5) already wrote
   `pr-reviews/<repo>-<branch>`. Ask whether to update it in place now that the
   PR exists — add the `[<repo>#<number>](<PR url>)` line and a **PR:** entry
   in `## Links`, and fold in the GitHub conversation (comments, review
   threads) via `pr-explain-review`. Don't generate a new note.
5. **Move Jira to Code Review?** If `jiraKey` is set, list available
   transitions (`jira_ticket_transition` without a transitionId). Ask
   explicitly whether to move the ticket to **In Code Review** (or the closest
   available equivalent). Only apply with `confirm: true` after a yes. If they
   decline, do not offer alternate Jira statuses unless they ask.
6. **Mark the DevHub task done?** Ask whether to mark this DevHub task
   complete (`tasks_update` / done). Only mark it done if they say yes. This
   is separate from the Jira status — do not treat a Code Review transition as
   completing the DevHub task.
7. **Recovery checkpoint.** If a meaningful blocker or workaround occurred,
   complete the checkpoint in [preflight.md](preflight.md) before handing off,
   including on Auto. Record whether it was fixed at source, documented as a
   workaround, or needs a follow-up. Skip this for routine successful work.

The user may stop after any step - that's fine. Their "no" is a complete
answer; do not re-ask.

## Blocked / failing path

If you cannot implement (missing context, failing baseline you can't fix,
ambiguous requirements):

- Write findings so far to the task note: what you tried, what blocked you,
  what you'd need. Read first and update the existing blocker section rather
  than appending the same report again.
- Offer the user: keep the task open with the note, or abandon with a reason.
- Do not mark anything done, do not open a PR, do not transition Jira further
  (if not-started → In Progress already ran, leave the ticket there).

## Task milestone updates

For a linked DevHub task, call `task_note_update op: "set_status_update"` with
`statusUpdate: {summary, whatChanged, currentState, nextStep}` at each milestone
(implementation done, failure, follow-ups), in short plain sentences without logs.
Implementation/QA owns UI evidence: reuse evidence that still matches, else
attach `add_media {localFile, caption, phase: "after"}` naming the commit,
scenario and gaps. If capture is unavailable, say why in `currentState`.
