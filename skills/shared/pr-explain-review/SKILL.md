---
name: pr-explain-review
description: >-
  Explain and review a GitHub pull request in plain language, with full
  context: the PR conversation (comments, reviews, unresolved inline threads)
  and the linked Jira ticket. Explains what the PR is for, how it's
  implemented, walks the code path from entry point to exit, and reviews it
  for KISS, DRY, developer experience, and over-engineering (ponytail
  laziness ladder). Use when the user gives a PR URL or number and asks to
  "review this PR", "explain this PR", "walk me through this PR", "what does
  this PR do", or invokes the dashboard "Review" button on the
  Review-requested list. Streams to the terminal and, when a notes path is
  given, saves the write-up as a DevHub note. Never posts to GitHub unless
  explicitly asked.
metadata:
  short-description: Explain + review a GitHub PR
---

# PR Explain & Review

## Overview

Given a GitHub PR (URL or `owner/repo#number`), produce two things in one pass:

1. **An explanation** a teammate can follow without opening the diff — purpose,
   how it works, and a walk through the code from entry point to exit.
2. **A review** that flags correctness/risk issues and, separately, complexity
   that should be deleted (KISS, DRY, DX, ponytail).

Stream the result to the terminal, and when the request names a notes path,
also save it as a DevHub note (see "Saving the review as a note"). Do not
comment, approve, or request changes on GitHub unless the user explicitly asks.

## When To Use

- A PR URL or `owner/repo#number` is given with intent to understand or review it.
- The dashboard "Review" button fired `opencode run` with a PR URL.
- The user says: review / explain / walk through / "what does this do" for a PR.

## Inputs

Accept any of: full PR URL, `owner/repo#123`, or a bare number when the repo is
already obvious from the working directory. Resolve to `OWNER/REPO` and `NUMBER`
before starting. `gh` must be authenticated (`gh auth status`).

## Workflow

### 1. Get the facts (default: no checkout)

Pull everything from `gh` — fast, works from any directory:

```bash
gh pr view  <url> --json title,body,author,baseRefName,headRefName,files,additions,deletions,state,url,comments,reviews
gh pr diff  <url>
# Inline review threads (file/line comments) — the part `pr view` doesn't return:
gh api repos/OWNER/REPO/pulls/NUMBER/comments --paginate \
  --jq '.[] | {path, line: (.line // .original_line), author: .user.login, in_reply_to: .in_reply_to_id, body}'
```

That gives the title, description, changed files, the full diff, **and the
conversation**: top-level comments, review verdicts with their bodies, and
inline threads anchored to files/lines. For most PRs this is enough — do not clone.

### 2. Pull the linked ticket

Find the ticket key — a Jira key (`ABC-123` pattern) in the PR title, branch
name (`headRefName`), or body, or a linked GitHub issue (`#N` / `Fixes #N`).

- **Jira key + DevHub MCP available:** call the `jira_ticket_get` tool with the
  key. Use the ticket's summary, description, and acceptance criteria as the
  source of intent — the review must answer "does this PR do what the ticket
  asks?", not just "is this code fine?".
- **GitHub issue:** `gh issue view N --json title,body,labels`.
- **No key, or the tool isn't available:** say so in one line ("no linked
  ticket found" / "Jira MCP unavailable") and continue from the PR body alone.
  Never invent ticket text.

### 3. Read the conversation before judging

Before writing findings, digest the comments and reviews from step 1:

- **Unresolved threads and requested changes** are review input — check whether
  the diff actually addresses them, and flag any that are still open.
- **Resolved/answered threads** are context — don't re-litigate a point a
  previous reviewer already accepted, unless it's a correctness bug.
- **Author replies** often explain non-obvious choices — fold that reasoning
  into the explanation instead of guessing at intent.

### 4. Decide if you need the whole repo

Escalate to a local clone **only when the diff can't be understood on its own** —
e.g. it touches many files, calls into code you can't see, or the
entry-to-exit walk would be guesswork. Signal of complexity: large/multi-module
diff, framework wiring, or the user said it's a big one.

When you do need it, reuse the developer's repo folder (the dashboard clones
there too). Repos live **as siblings of this repo** — the scan dir is the parent
of the devhub repo root.

```bash
# REPOS_DIR = parent folder where all dev repos are cloned (sibling of devhub)
if [ -d "$REPOS_DIR/REPO" ]; then
  cd "$REPOS_DIR/REPO" && git fetch origin
else
  gh repo clone OWNER/REPO "$REPOS_DIR/REPO" && cd "$REPOS_DIR/REPO"
fi
gh pr checkout NUMBER   # now explore the full codebase, not just the diff
```

Read the surrounding files the diff plugs into — that's what makes the
entry-to-exit walk real instead of inferred. Do not modify the branch.

### 5. Explain (plain language)

Write for a teammate skimming on their phone. Prose, not a file dump.

- **What it's for** — one or two sentences. The problem, not the patch. Lead
  with the ticket's intent (step 2) when there is one; never invent ticket text.
- **How it's implemented** — the approach in a few sentences: the key change,
  the pattern used, anything notable (new dependency, migration, config flag).
- **Walk it entry → exit** — trace the actual path the change introduces or
  alters. Start at the entry point (route handler, CLI command, event, exported
  function, UI action) and follow control flow to the result (response, write,
  render, return), naming the files/functions on the way. Call out branches,
  side effects, and error paths. This is the core of the explanation — make the
  reader able to find their way through the code unaided.

### 6. Review

Two clearly separated passes. Lead with what's broken, risky, or missing —
save praise for code that earns it.

**Pass A — Correctness & risk.** Bugs, broken edge cases, unhandled errors,
security holes, data-loss paths, missing tests for non-trivial logic, breaking
changes. Be specific: `file:Lxx — what's wrong and why`. Include **ticket
fit** — anything the ticket asks for that the diff doesn't deliver — and any
**unresolved reviewer requests** from step 3 that remain unaddressed.

**Pass B — Complexity (ponytail).** Hunt only for what to delete. One line per
finding: location, what to cut, what replaces it.

- `delete:` dead code, unused flexibility, speculative feature → nothing replaces it.
- `stdlib:` hand-rolled thing the standard library ships → name the function.
- `native:` dependency/code doing what the platform already does → name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `dry:` logic duplicated from an existing helper → point at the helper to reuse.
- `shrink:` same behaviour, fewer lines → show the shorter form.

Apply the laziness ladder when judging — stop at the first rung that holds:
**YAGNI → stdlib → native platform → existing dependency → one line → minimal
code.** The best code is the code never written; the best outcome for this diff
is getting shorter.

Do **not** flag as bloat: input validation at trust boundaries, error handling
that prevents data loss, security, accessibility, or a single smoke/`assert`
self-check on non-trivial logic. Those earn their lines.

**DX check.** Note naming, readability, surprising names, and anything that
would make the next person decode at 3am — but keep it short.

### 7. Verdict

End with a one-line call and the complexity metric:

- Verdict: `Approve` / `Approve with nits` / `Needs changes` / `Blocking` — with the single reason.
- `net: -<N> lines possible.` — or `Lean already. Ship.` if there is nothing to cut.

## Output Shape

```
<repo>#<number> — <title>

What it's for: ...        (ticket intent when linked)
How it works: ...

Ticket & conversation:    (omit when there's neither)
  <KEY> — <one-line ticket summary; acceptance criteria met? yes/partial/no>
  <n> comments, <m> reviews — unresolved: <thread or "none">

Walkthrough:
  1. <entry: file:fn> → ...
  2. ... → <exit: result>

Review — correctness:
  file:Lxx — ...

Review — complexity:
  file:Lxx: stdlib: ... → ...
  net: -N lines possible.

Verdict: <call> — <one reason>.
```

## Saving the review as a note

When the request names a notes path — the dashboard "Review" button appends
`Notes MCP path: pr-reviews/<owner>-<repo>-<number>` — save the finished
write-up there so the dashboard can link to it.

**Write through the notes MCP, never by creating files directly.** Always use
**`notes_write`** with the exact path given. The launch command pins `NOTES_DIR`
to the DevHub repo, and the notes MCP is what knows that location — writing a
`.json`/`.md` file by hand lands it in the wrong place (the bug this flow
exists to avoid). If the notes MCP isn't available, say so instead of writing
files; don't guess a path.

Pass Markdown to `notes_write` (the server converts it to BlockNote). Use this
section layout — it's what the dashboard note view is tuned for.

The H1 is **just the PR title** (no `repo#number` prefix). Directly under it,
put a small sub-header line that links to the PR — the `repo#number` as the
link text. Keep it a normal line (not a heading) so it reads as a small link,
not a second title. Then the metadata as a short bullet block.

```markdown
# <title>

[<repo>#<number>](<PR url>)

**Verdict:** <call> — <one-line reason>.

- **Jira:** <link if any>
- **Author:** <author>
- **Size:** +<additions>/-<deletions> across <n> files
- **State:** <open / draft / …>

## At A Glance
One or two sentences: what changes and whether it's safe to ship.

## What It's For
The problem, in plain language — grounded in the linked ticket when there is one.

## Ticket & Conversation
Only when a ticket or discussion exists. One short block: what the ticket asks
for and whether this PR delivers it, then any unresolved review threads or
requested changes (and whether the diff addresses them). Skip the section
entirely when the PR has neither.

## Implementation Map
The approach and the files it touches.

## Walkthrough
1. **<entry — file:fn>** → ...
2. ... → **<exit — result>**

## Review Findings
### Must Fix
- `file:Lxx` — ...
### Should Fix
- ...
### Nice To Have / DX
- ...

## Complexity
- `file:Lxx` stdlib: ... → ...

**net: -N lines possible.**

## Tests Checked
What's covered, what's missing.

## Verdict
<call> — <one reason>.
```

Formatting that renders cleanly: headings, **bold** lead-ins, bullet and
numbered lists, and `inline code` / fenced code. **Avoid Markdown blockquotes
(`> …`)** — the notes renderer shows the literal `>` instead of a quote block;
use a bold line or a bullet instead.

`notes_write` replaces the whole note, so write it in one pass; re-running the
review on the same PR overwrites the previous note. Stream the same review to
the terminal too — the note is the persistent copy, not a replacement for the
live output.

## Rules

- Don't post to GitHub. Writing the review **note** is fine; commenting,
  approving, or requesting changes on the PR (`gh pr review` / `gh pr comment`)
  happens **only** if the user explicitly asks, and show them the text first.
- Never invent ticket titles, issue numbers, or descriptions.
- Don't push, commit, or modify the PR branch.
- No AI attribution footers anywhere.
- Prefer the cheapest path that answers the question: `gh` diff first, clone only
  when the walk genuinely needs the surrounding code.

## Verification

Before presenting, confirm the entry-to-exit walk names real files/functions
from the diff or repo (not guesses), and that every complexity finding cites a
concrete location. If you couldn't fetch the PR (`gh` not authed or wrong repo),
say so plainly instead of guessing.
