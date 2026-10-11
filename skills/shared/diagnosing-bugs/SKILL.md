---
name: diagnosing-bugs
description: >-
  Build a tight failing loop before theorising, then reproduce, minimise,
  test a few hypotheses, and lock the fix with a regression test. Use when
  the user says diagnose or debug, or reports something broken, throwing,
  failing, or slow.
metadata:
  short-description: Diagnose a bug from a failing loop
---

# Diagnosing bugs

A discipline for a hard bug. Skip a phase only when you can say why.

If the repo has `GLOSSARY.md`, read it before naming modules. Check ADRs in the area you touch. If a DevHub task owns the bug, read its note and the Jira ticket before inventing a theory.

If the broken thing is DevHub and a page never loads, load `devhub-debug-hang` and check `status_exec` before this loop. One stuck subprocess looks like a dead app.

If the bug is in the DevHub dashboard UI, load `devhub-dashboard-verify`. Checkout changes are not on port 1337 while the packaged app holds it.

## Redact

Show commands, output, and captured artifacts only after secrets are gone. Write `<REDACTED>` in their place. Build the loop against env vars so the credential stays in the environment. Quote the lines that carry the signal, not a whole HAR of auth headers. No customer data in fixtures, notes, or commits.

If the redacted output is not enough, say so and ask.

## Phase 1: Build a feedback loop

This is the skill. A tight pass/fail signal that goes red on this bug will find the cause. Staring at code will not.

Try these, roughly in order:

1. A failing test at a seam that reaches the bug.
2. Curl or an HTTP script against the dev server.
3. A CLI run with a fixture, diffed against a known-good snapshot.
4. A headless browser script that asserts on DOM, console, or network. For a local DevHub page, `playwriter` is available.
5. Replay a captured request, payload, or event log through the code path on its own.
6. A throwaway harness: one service, mocked deps, one function call.
7. A property or fuzz loop when the bug is "sometimes the wrong output".
8. A bisection harness when the bug appeared between two known commits, datasets, or versions, so `git bisect run` can drive it.
9. The same input through the old version and the new one. Diff the output.
10. Last resort: a short script the user runs that prints the symptom and exits non-zero. You still get a structured result back.

Then tighten it. Faster, a sharper assert on the exact symptom, and deterministic (pin time, seed, filesystem, network). A 30-second flake is barely a loop. A 2-second deterministic one is the point.

Non-deterministic bugs: raise the reproduction rate until you can debug against it. Loop the trigger, add stress, narrow the timing window. Fifty percent is debuggable. One percent is not.

If you genuinely cannot build a loop, stop. List what you tried. Ask for access to the environment that reproduces it, a redacted capture (HAR, log, screen recording with timestamps), or permission to add temporary production instrumentation. Do not hypothesise without a loop.

Phase 1 is done when you can name one command you have already run (show the invocation and the redacted output) that is:

- Red-capable: it drives the bug path and asserts the user's exact symptom, so it can go red on this bug and green once fixed.
- Deterministic, or a pinned high reproduction rate.
- Fast: seconds, not minutes.
- Runnable by you unattended, unless the last-resort user script is the only option.

No such command, no Phase 2.

## Phase 2: Reproduce and minimise

Run the loop. Confirm it fails the way the user described, not a nearby failure. Capture the exact symptom.

Then shrink the repro. Cut inputs, callers, config, data, and steps one at a time, re-run, and keep only what the failure needs. Done when removing any remaining piece makes the loop go green.

## Phase 3: Hypothesise

Write 3 to 5 ranked hypotheses before testing any of them. Each one states a prediction: "If X is the cause, then changing Y makes the bug disappear, or changing Z makes it worse." If you cannot state the prediction, discard it.

Show the list to the user before testing. They often re-rank it. If they are away, proceed with your ranking and say so.

## Phase 4: Instrument

One variable at a time. Each probe maps to one prediction.

1. A debugger or REPL, when the environment has one.
2. Targeted logs at the boundary that distinguishes hypotheses.
3. Not "log everything and grep".

Tag every debug log with a unique prefix, for example `[DEBUG-a4f2]`, so cleanup is one search.

Performance regressions: measure first. A timing harness, a profiler, or a query plan. Then bisect. Logs are usually the wrong tool.

## Phase 5: Fix and regression test

Write the regression test before the fix, when there is a correct seam. A correct seam exercises the real bug pattern at the call site. A test that cannot see the chain that triggered the bug gives false confidence. If no such seam exists, say so. That is a finding for `improve-codebase-architecture`, not a reason to fake a test.

When the seam exists:

1. Turn the minimised repro into a failing test.
2. Watch it fail. If you forced the red by mutating code or a fixture, diff against a clean copy before you trust it.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 loop against the original, un-minimised scenario.

## Phase 6: Cleanup

- The original repro no longer reproduces.
- The regression test passes, or the missing seam is written down.
- Every `[DEBUG-...]` line is gone.
- Throwaway harnesses are deleted, or clearly marked and not on the branch you will ship.
- The hypothesis that was right is in the commit or PR message, in the repo's normal style. For a Jira repo that is `<KEY>: <why>`.

## Attribution

Adapted from Matt Pocock's `diagnosing-bugs` skill (https://github.com/mattpocock/skills).

Copyright (c) 2026 Matt Pocock.

Permission is granted, free of charge, to anyone obtaining a copy of this material to deal in it without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, provided this copyright notice and this permission notice appear in all copies or substantial portions. The material is provided as is, without warranty of any kind, express or implied.
