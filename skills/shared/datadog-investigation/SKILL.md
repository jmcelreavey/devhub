---
name: datadog-investigation
description: Triage and investigate a Datadog alert (BI DAD team) — correlate it with recent deploys/commits, identify the owning service, and recommend the next dashboards, logs, and mitigations. Use when investigating an @oncall-dad page or @slack-dad-team-alerts warning, or when DevHub's "Investigate" button hands off an alert to OpenCode.
---

# Datadog Investigation

## Overview

Turn a single Datadog alert into a concrete, prioritized investigation. The goal is to
answer three questions fast: **what broke, what changed, and what to check next.**

DevHub's Datadog page (`/datadog`) and Today strip surface recent `@oncall-dad` (urgent,
paging) and `@slack-dad-team-alerts` (team channel, non-paging) alerts. The "Investigate"
button creates an OpenCode session pre-loaded with the alert context and these steps.

## When to Use

- An `@oncall-dad` alert is paging and you need to triage it now.
- A `@slack-dad-team-alerts` warning needs a root-cause pass.
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
Prioritize `@oncall-dad` (urgent) over `@slack-dad-team-alerts` (non-paging).
