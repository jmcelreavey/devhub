---
name: devhub-repo-ownership
description: Use when triaging an owned repository, catching up on inbound changes, deciding review versus delegation, identifying path owners, or choosing the next domain to learn.
metadata:
  short-description: Triage an owned repo
---

# Repo Ownership

## Overview

Use DevHub's repo-centric ownership evidence to decide what needs attention. Keep GitHub write actions on GitHub; this workflow arranges evidence and records decisions.

## Workflow

1. Call `repo_owner_brief` with `owner/repo`.
2. Handle failing CI, unattended PRs, uncovered paths, and stale obligations first.
3. For risky PRs, call `repo_who_owns` on the touched paths and inspect missing coupling companions.
4. Decide one outcome: review it, delegate it to an evidenced owner, watch it, or explicitly accept no action.
5. Use `repo_knowledge_gaps` to choose learning work only after operational obligations are clear.
6. Record consequential decisions in a DevHub note with links to the repo or PR.

## Evidence Rules

- CODEOWNERS is declared ownership.
- Commit and review history is familiarity, not authority.
- Churn-inferred grouping is a hint, never a team assignment.
- A partial or remote-only brief must say what could not be calculated.

## Verification

- Every recommended reviewer or delegate has cited ownership/history evidence.
- Every ignored obligation has an explicit reason.
- No comment, approval, merge, or assignment was performed from this workflow.
