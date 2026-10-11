---
name: grill-with-docs
description: >-
  Interview the user about a plan or design until nothing is silently assumed,
  and write resolved terms and hard-to-reverse decisions down as you go. Use
  when the user says "grill", "grill this", or wants a plan stress-tested
  before anyone builds it.
metadata:
  short-description: Grill a plan and write the docs
disable-model-invocation: true
---

# Grill with docs

Stress-test a plan with the user, and leave a paper trail. You interview. They decide. You write the glossary and the rare ADR the moment a term or a decision settles.

## When to use

- The user wants a plan, design, or ticket sharpened before implementation.
- Domain words are fuzzy, overloaded, or fighting the code.
- A DevHub task is still a draft and the open questions are design questions, not missing file paths.

Load `devhub-plan-write` when the job is to fill a DevHub plan note. This skill is the interview that feeds that plan.

## Where the docs go

Write into the repo you are designing:

- `GLOSSARY.md` at the repo root for one context. If `GLOSSARY-MAP.md` exists, follow it to the right context.
- `docs/adr/NNNN-slug.md` for a decision that earns an ADR.

Create files lazily, on the first term or the first ADR. Formats: [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md), [ADR-FORMAT.md](./ADR-FORMAT.md).

When a DevHub task is in play, also record the resolved terms and any ADR path on the task note (`notes_read`, then `notes_write` or `notes_append`, keeping existing sections). The repo file is the source of truth. The note is how the next session finds it. Link the ADR from the Jira ticket only when the user asks.

No working repo: still grill. Keep the glossary in the task note. Do not invent a `GLOSSARY.md` in the home directory or in DevHub's own tree unless DevHub is the thing being designed.

DevHub itself: glossary and ADRs belong in the private mirror. Do not put them on the public core unless the user is backporting, and do not put personal terms in a shared glossary.

## Grilling

Map the plan as a design tree. Every decision branches into the decisions that hang off it.

Work in rounds. The frontier is every decision whose prerequisites are already settled: the questions you can ask now. Ask the whole frontier in one round. Number each question and give your recommended answer. Then wait.

```
Q1. <question title>
<question body. "Yes" accepts the recommended answer.>

Recommended: <answer>

Q2. <question title>
<question body.>

Recommended: <answer>
```

Each round reshapes the tree. Settled decisions push the frontier out. A question that depends on another question still open in this round waits for the next round.

Finding facts is your job. When a frontier question needs something from the repo, the ticket, or the filesystem, go and look. A lookup still running is an unsettled prerequisite: ask the rest of the frontier now, and hold only the questions that depend on it. The decisions are the user's. Put each one to them and wait.

The session is done when the frontier is empty and the user confirms you share an understanding. Do not start building, open a PR, or transition Jira before that.

## Domain model

Do this during the interview, not afterwards.

- A term that fights `GLOSSARY.md`: say so. "The glossary defines cancellation as X. You seem to mean Y. Which is it?"
- A vague or overloaded word: propose one canonical term. "Account: do you mean the Customer or the User?"
- A relationship between concepts: invent a concrete scenario that probes the edge. Prefer a real case from the code or the Jira ticket over a toy.
- A claim about how the system works: check the code. If they disagree, surface it. "The code cancels the whole Order. You just said a partial cancel is possible. Which is right?"
- A term that just got resolved: update `GLOSSARY.md` immediately. The glossary is definitions only. No implementation, no spec, no scratch notes.

Offer an ADR only when all three are true:

1. Hard to reverse.
2. Surprising without the context. A later reader will ask why it works this way.
3. A real trade-off. There were alternatives, and you picked one for a reason.

If any of the three is missing, skip the ADR. When the user rejects a design for a reason a later session would need, offer to record that too.

## When one session is the wrong shape

Work that will not fit one session becomes decision tasks on the Jira ticket, or DevHub tasks: one question each, referred to by title, one resolved per session. Do not turn that map into build slices, and do not start the build. Adapted from Matt Pocock's `wayfinder` skill (MIT).

When the open question is whether the behaviour feels right, or what a screen should look like, offer a throwaway prototype off `main` and keep only the decision that survived. Mark it throwaway. No tests, no persistence unless the question is persistence. Adapted from his `prototype` skill (MIT).

When the answer sits with someone else, write them a short questionnaire: who it is for, what you need back, one idea per question, most important first. Do not guess their answer. Adapted from his `to-questionnaire` skill (MIT).

## Attribution

Adapted from Matt Pocock's `grill-with-docs`, `grilling`, and `domain-modeling` skills (https://github.com/mattpocock/skills).

Copyright (c) 2026 Matt Pocock.

Permission is granted, free of charge, to anyone obtaining a copy of this material to deal in it without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, provided this copyright notice and this permission notice appear in all copies or substantial portions. The material is provided as is, without warranty of any kind, express or implied.
