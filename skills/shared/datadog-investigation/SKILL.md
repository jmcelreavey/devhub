---
name: datadog-investigation
description: Investigate a Datadog alert or monitor and suggest mitigations. Use when the user pastes a Datadog alert or monitor link, or asks why a monitor fired.
---

# Datadog Investigation

## Overview

Turn a single Datadog alert into a concrete, prioritized investigation. The goal is to
answer three questions fast: **what broke, what changed, and what to check next.**

Use the alert context supplied by the configured Datadog integration or the user.

## When to Use

- A paging alert needs immediate triage.
- A non-paging warning needs a root-cause pass.
- You want to correlate an alert with a recent deploy or commit.

## How to Use

1. **Read the alert.** Note the title, status, fired time, and tags. The tags usually name
   the owning `service`, `env`, and `team`.
2. **Establish ownership.** From the tags, identify the service and which repo/team owns it.
3. **Correlate with change.** Look at deploys and commits in the ~1–2 hours before the alert
   fired. A recent release is the most common cause.
4. **Point at the data.** Name the specific Datadog dashboard, monitor, log query, or metric
   to inspect next — don't hand-wave "check the logs".
5. **Mitigate if user-facing.** If impact is customer-visible, recommend the fastest safe
   mitigation (rollback, feature flag, scale-up) before deeper root-cause work.

## Output

A concise summary: **what the alert means**, **the most likely cause** (with the change you
suspect), **the exact next checks**, and **an immediate mitigation** if warranted.
Prioritise paging alerts over non-paging warnings.
