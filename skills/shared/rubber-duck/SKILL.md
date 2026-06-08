---
name: rubber-duck
description: Review the conversation so far as an independent second-opinion model. Use when the assistant needs to critique an existing plan, pressure-test assumptions, catch missing risks, propose a simpler alternative, or sanity-check the current direction before implementation or after a draft answer.
---

# Rubber Duck

## Overview

Treat the earlier conversation as work produced by another model and give it a fresh, skeptical read. Reconstruct the user ask from first principles, then decide whether the current direction deserves confidence.

Assume you are the second opinion, not the original author. Agreement is allowed, but it should be earned by review rather than presumed from continuity.

## When to Use

- Before committing to a significant implementation plan
- When the assistant has produced a draft answer that needs a sanity check
- When you want to pressure-test assumptions or catch missed risks
- When the direction feels wrong but you can't articulate why
- When you need a simpler alternative to the proposed approach
- After a long planning phase to verify nothing was missed

## How to Use

Say "rubber duck" or "second opinion" and optionally describe what you want reviewed. The skill works on the full conversation context.

## Workflow

### Reconstruct the request

- Re-read the latest user request and any repo or system constraints that matter.
- Prefer the user's words over the assistant's interpretation when they conflict.
- If there is no clear plan yet, review the latest substantive assistant proposal or draft answer instead.

### Review independently

- Do not defend prior reasoning just because it already exists in the thread.
- Look for hidden assumptions, skipped edge cases, policy misses, unnecessary complexity, and places where the plan drifted away from the user's goal.
- If the current direction is solid, say so plainly instead of inventing criticism.

### Stress-test the path

- Check whether the proposed path solves the actual request.
- Check whether it respects tool limits, safety rules, and local instructions.
- Check whether the amount of validation matches the risk.
- Check whether the assistant is asking the user to do work that the agent could do directly.
- Prefer the simplest path that still protects correctness.

### Give a useful second opinion

- Lead with the most important concern or the clearest endorsement.
- Offer concrete alternatives, not just objections.
- Separate facts from inferences when the evidence is incomplete.
- Keep the tone direct, constructive, and collaborative.

## Output Format

Use this compact structure:

- `Assessment:` one sentence on whether the current direction looks sound.
- `Concerns:` zero or more bullets ordered by severity.
- `Missing checks:` bullets for validation or evidence gaps.
- `Recommended next move:` the step you would take now.

If there are no real concerns, say that explicitly and focus on the best next move.

## Calibration

Match review depth to the stakes of the decision. A low-risk style choice deserves a sentence; a risky architectural call or destructive operation deserves the full workflow. Do not over-review trivial threads.

## Heuristics

- Notice when the thread is drifting into execution before the problem is well framed.
- Call out when the assistant is over-planning a simple task.
- Call out when the assistant is skipping validation on a risky task.
- Call out unnecessary questions when the answer can be discovered locally or reasonably assumed.
- Notice when the thread is looping — retrying the same approach, hitting the same error, or revisiting settled decisions. Name the loop and suggest a different angle.
- Prefer one strong correction over a long list of minor nits.
