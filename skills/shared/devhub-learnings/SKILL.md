---
name: devhub-learnings
description: Use when creating or updating DevHub learning notes under the notes MCP learnings/ tree. Helps write KISS, junior-dev-friendly notes with simple explanations, examples, and clear takeaways.
metadata:
  short-description: Create DevHub learning notes
---

# DevHub Learnings

## Overview

Use this skill to create or update reusable learning notes in DevHub notes, usually under `learnings/<area>/<topic>`. The default outcome is a short, useful note that explains a concept in simple terms, includes examples when helpful, and is easy for a junior developer to scan later.

## When To Use

- The user asks to create, update, capture, or write a learning note.
- The user asks to document the 5Ws, a mental model, a gotcha, or a reusable explanation.
- The note belongs in the DevHub notes MCP `learnings/` tree.
- The user says something like "write this down", "create a learning", or "save this as a note".

## Principles

- Keep it KISS: simple, direct, and practical.
- Write for a junior developer who has context on coding but not on this topic.
- Prefer plain English before introducing technical terms.
- Explain acronyms or repo-specific names the first time they appear.
- Use examples, file paths, commands, or code snippets when they make the idea clearer.
- Skip sections that would be filler.
- Avoid vague audience sections like "Who" unless the audience is genuinely important.
- Avoid phrases that make the reader feel behind, such as "obviously", "just", or "simple".
- Do not include secrets, tokens, credentials, or private values.

## Workflow

1. Confirm or infer the note path under `learnings/`. If the path is unclear, ask one short clarifying question.
2. Read the existing note with `notes_read` when updating or when you need to avoid overwriting useful context.
3. If the task updates an existing structured note, especially one the user says they already edited, verify the exact backing file under `REPO_ROOT/notes/<path>.json` before editing. `notes_read` is useful for content, but the file is the source of truth for BlockNote structure.
4. Draft the note in Markdown using only sections that help the reader understand the topic.
5. Prefer concrete repo evidence from the current conversation, files, or commands over memory.
6. Choose the safest write path:
   - Use `notes_write` only when intentionally replacing the whole note after rereading the latest version.
   - Use `notes_append` only when the user explicitly wants content added at the end.
   - For targeted edits inside an existing note, table, or section, patch the on-disk BlockNote JSON or use the app/API path that preserves the existing block structure. Do not rewrite the whole note from memory.
7. Re-read the note with `notes_read` and, for targeted edits, also inspect or search the exact `REPO_ROOT/notes/<path>.json` file to confirm the requested headings/table rows/strings exist in the saved file.
8. Report the path and a brief summary of what was captured.

## Existing Note Update Rules

- Treat user-edited notes as concurrent state. Always reread immediately before writing.
- Do not trust a rendered `notes_read` response alone for structural changes. It may hide whether a table row, heading, or block landed in the intended place.
- If the user names a concrete path such as `learnings/email-person-enrichment-strategy`, verify that the file exists at `REPO_ROOT/notes/learnings/email-person-enrichment-strategy.json` when you are in the DevHub repo.
- If MCP and the on-disk file disagree, fix the on-disk DevHub note and then verify again with both file inspection and `notes_read`.
- When a note has tables or carefully arranged sections, prefer surgical edits over full `notes_write` replacement.
- If a write operation says it created a note that should already exist, stop and inspect the backing file/path before continuing.

## Section Guidance

Use these sections as building blocks, not as a mandatory template:

- `Summary`: one sentence with the main takeaway for someone skimming.
- `What It Is`: a plain-English definition of the concept.
- `Why It Matters`: the problem it solves or the risk it reduces.
- `When To Use It`: concrete situations where this applies.
- `Where It Lives`: repo paths, tools, services, commands, or note paths.
- `How It Works`: a step-by-step explanation or mental model.
- `Example`: a small realistic code, config, command, or workflow example.
- `Watch Outs`: common mistakes, edge cases, or "do not do this" notes.
- `Takeaway`: one short thing to remember.

Prefer `Summary`, `What It Is`, `Why It Matters`, `When To Use It`, and `Example` by default. Add `Where It Lives` for repo, tool, or system topics. Add `Watch Outs` when there are pitfalls.

## 5Ws Notes

If the user asks for the 5Ws, map them into useful learning sections instead of forcing a rigid template:

- Who: include only when the audience or owner matters.
- What: use `What It Is`.
- When: use `When To Use It`.
- Where: use `Where It Lives`.
- Why: use `Why It Matters`.

Add `How It Works`, `Example`, and `Watch Outs` when they make the note more useful.

## Verification

- Confirm the note path is relative to the DevHub notes root, such as `learnings/web/feature-flags`.
- Re-read the note after writing it.
- For updates to existing notes, verify the expected changes in `REPO_ROOT/notes/<path>.json` as well as through `notes_read`.
- For table/section edits, search for the exact requested heading, table row, or key phrase in the saved JSON before reporting success.
- For skill-file edits, ensure `SKILL.md` exists and starts with YAML frontmatter.
