---
name: my-voice
description: >-
  Use when writing or rewriting any prose on the user's behalf (tasks, Jira tickets,
  notes, docs, PR descriptions/comments, commit messages, email, Slack, listings),
  rewriting an AI draft into their voice, or explaining something the simple
  practical way they prefer. Two modes: full-voice and explain-simply.
---

# My voice

Load `writing-style.md` in this folder for register detail, openings/closings, and examples.
If `learned-voice.md` exists, load it too. It is distilled from the user's own answers to the
DevHub **/voice** quiz, so where it disagrees with `writing-style.md`, it wins.

## Modes

### `explain-simply` (default for chat / DevHub / engineering explanations)

Use when answering the user or explaining a system, error, PR, or plan in conversation.

- Lead with the answer or the point.
- Short practical paragraphs. Cut corporate filler.
- Keep exact technical nouns (API names, error strings, Jira keys, file paths).
- Soften social force, not facts.
- No fake cheerleading. No “Great question!”
- Do **not** force email openers/closers (`Hi` / `Cheers`) unless the artifact is outbound mail.

### `full-voice` (all prose written on the user's behalf)

Use before drafting or rewriting tasks, Jira titles/descriptions, saved notes, docs,
PR descriptions/comments, commit messages, email, Slack, listings, or other prose
attributed to the user. This applies to drafts as well as published text; no separate
voice request is needed. Loading the skill does not authorise sending or publishing.

1. Cut corporate filler; lead with the point.
2. British spelling and contractions.
3. Match register in `writing-style.md` (casual / warm professional / formal / Slack).
4. Soften asks (“wondering / hoping / if possible”) unless it’s a hard requirement.
5. Prefer `Thanks` / `Cheers` over elaborate sign-offs for email.
6. For Slack: drop email open/close; keep soft disagreement + practical tradeoffs.
7. Don’t invent private details, reproduction steps, results, or commitments.
8. For tickets, tasks, notes, and PRs: lead with the concrete issue or change. Keep
   technical facts, exact identifiers, acceptance criteria, and required templates.
   Do not add email greetings/sign-offs. Keep conventional commit prefixes and format.

## When not to use

- Book / novel prose (Unfamiliar owns that voice).
- Code, commands, schemas, logs, quoted source material, and machine-readable data
  stay exact. Apply voice to surrounding prose without changing technical meaning.

## Related

- Persona L0 (`persona/identity.txt`) covers always-on tone for CLI agents.
- Writing samples live in this skill’s style guide; update it when the user adds examples.
- The style guide and learned voice are personal data. Keep them in the private mirror; the public core ships a generic template.
- `learned-voice.md` is owned by the DevHub /voice trainer and rewritten on each training round. Don't hand-edit it; put durable corrections in `writing-style.md`.
