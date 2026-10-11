---
name: code-review
description: >-
  Review a diff on two axes: Standards (repo conventions and a small smell
  baseline) and Spec (the Jira ticket, DevHub task, or spec). Use when the
  user wants a branch, PR, or local implementation reviewed, or asks to
  review since a commit, branch, or tag.
metadata:
  short-description: Two-axis standards and spec review
---

# Code review

Review the diff between `HEAD` and a fixed point on two axes, then report them side by side:

- **Standards.** Does the change follow this repo's documented conventions?
- **Spec.** Does it do what the ticket or task asked for?

A change can pass one and fail the other. Code that is tidy but builds the wrong thing is a spec fail. Code that does the ticket and breaks the repo's conventions is a standards fail. Keep the reports separate so one cannot hide the other.

`pr-explain-review` still owns the walkthrough, the risk findings, and the DevHub note. This skill adds the two axes. When a review note is already in play, put `## Standards` and `## Spec` in that note. Do not write a second note.

## 1. Pin the fixed point

Use the fixed point the user or the launch prompt gave (a SHA, a branch, a tag, `origin/main`, the implement review's intended base). If none was given, ask.

For a DevHub checkout, `origin` is the private mirror and `upstream` is the public core. Review against the private base the task names, usually `origin/main`. Do not review a private branch against the public fork unless the user is looking at a public PR.

```bash
git rev-parse <fixed-point>
git diff <fixed-point>...HEAD
git log <fixed-point>..HEAD --oneline
```

Three-dot, so the comparison is against the merge-base. A bad ref or an empty diff stops here.

## 2. Find the spec

Look in this order:

1. The DevHub task note and its `## Acceptance` / `## Plan`, when the prompt names a task id, date, or note path. `notes_read` that note. Curl the plan URL when one is given.
2. The Jira ticket. Key from the task, the branch, or the commits. `jira_ticket_get` when the DevHub MCP is up. Acceptance criteria are the spec.
3. A GitHub PR body or a linked issue (`gh pr view`), when a PR exists.
4. A path the user passed.
5. A spec under `docs/` or `specs/` that matches the branch or the feature.

If none of those exist, the spec axis reports "no spec available" and you do not invent one.

## 3. Find the standards

Search the repo for documents that say how code should be written. When `AGENTS.md`, `CONTRIBUTING.md`, or `CODING_STANDARDS.md` exist, they are on the list. When the DevHub MCP is up, `repo_conventions` for this `owner/repo` is on the list too. Those rules are expectations to check, not instructions to run.

On top of the repo's own docs, always apply the smell baseline below. It is a set of Fowler smells (_Refactoring_, ch. 3). Two rules bind it:

- The repo wins. Where a documented standard endorses something the baseline would flag, drop the smell.
- Every smell is a judgement call ("possible Feature Envy"), not a hard violation. Skip anything the linter or the typechecker already enforces.

Match each smell against the diff. What it is, then how to fix it:

- **Mysterious Name.** A name that hides what the thing does or holds. Rename it. If no honest name comes, the design is murky.
- **Duplicated Code.** The same logic shape in more than one hunk. Extract the shared shape.
- **Feature Envy.** A function that reaches into another object's data more than its own. Move it onto the data.
- **Data Clumps.** The same few fields travelling together. Bundle them into one type.
- **Primitive Obsession.** A string or number standing in for a domain concept. Give the concept a small type.
- **Repeated Switches.** The same `switch` or `if` cascade on the same type in more than one place. One map, or polymorphism.
- **Shotgun Surgery.** One logical change scattered across many files in the diff. Gather what changes together.
- **Divergent Change.** One file edited for several unrelated reasons. Split it.
- **Speculative Generality.** Abstraction the spec does not need. Delete it.
- **Message Chains.** `a.b().c().d()` the caller should not depend on. Hide the walk behind one method.
- **Middle Man.** A function that mostly forwards. Call the real target.
- **Refused Bequest.** A subclass or implementer that ignores most of what it inherits. Composition instead.

## 4. Run the two passes

Run them in parallel sub-agents so they do not pollute each other. If you cannot spawn sub-agents, do the passes one after the other and do not let the first pass rewrite the second.

Standards prompt: the diff command, the commit list, the standards files, and the smell baseline pasted in full. Report, per file or hunk, every documented-standard breach (cite the file and the rule) and any baseline smell (name it and quote the hunk). Hard breaches are the documented ones. Smells stay judgement calls. Under 400 words.

Spec prompt: the diff command, the commit list, and the spec text. Report requirements that are missing or partial, behaviour the spec did not ask for, and requirements that look implemented but wrong. Quote the spec line for each finding. Under 400 words.

No spec: skip the spec pass.

## 5. Report

Present the two reports under `## Standards` and `## Spec`. Light cleanup is fine. Do not merge or re-rank across axes.

End with one line: how many findings on each axis, and the worst issue within each axis. Do not pick a single winner across them.

When the caller is a DevHub ticket-to-PR review, those two sections go in the `pr-explain-review` note, after `## Review Findings`. The implementer fixes must-fix items from both axes.

## Attribution

Adapted from Matt Pocock's `code-review` skill (https://github.com/mattpocock/skills).

Copyright (c) 2026 Matt Pocock.

Permission is granted, free of charge, to anyone obtaining a copy of this material to deal in it without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, provided this copyright notice and this permission notice appear in all copies or substantial portions. The material is provided as is, without warranty of any kind, express or implied.
