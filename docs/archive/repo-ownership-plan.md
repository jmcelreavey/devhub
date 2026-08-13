---
title: Repo ownership plan
description: Shipped implementation plan for DevHub's repo-centric ownership workspace.
order: 5
icon: Archive
tags: [archive, repos, ownership]
---

# Repo Ownership Plan

Status: **shipped** (2026-08-11). Sibling of `NOTES_AND_LEARNINGS_PLAN.md` and
`TEMPLATE_AND_PLUGIN_PLAN.md`.

Archived after shipping the ownership workspace.

Trigger: taking ownership of CAPI. The problem is general — "I am accountable
for a repo I did not write, that several teams change without telling me" — and
this ships as a general surface. CAPI is the first repo marked owned, not a
special case in the code.

---

## Why now

DevHub already knows a great deal about repos. None of it is arranged around
_ownership_.

| Surface                 | What it answers                       | Whose view           |
| ----------------------- | ------------------------------------- | -------------------- |
| `/prs`                  | PRs I authored or was asked to review | mine, pull-based     |
| `/repos/learn/[name]`   | What is this codebase, in general     | snapshot, whole-repo |
| `RepoRadarSection` (bi) | Which technologies appear here        | snapshot, taxonomy   |

The owner's questions are none of these:

1. What is happening to my repo **right now**, including by people who will
   never add me as a reviewer?
2. Of the things changing, which do I **not understand**?
3. What merged **while I wasn't looking**?
4. What am I **on the hook for** that nobody has told me about?

`/prs` is structurally unable to answer (1) — it is a query for _me_, and
another team opening a PR against a repo I own does not match it.
`/repos/learn` is unable to answer (2), because it treats every directory as
equally worth learning; an owner's learning budget should follow inbound churn,
not file count.

> [!IMPORTANT]
> The distinguishing move of this plan is **repo-centric, not person-centric**.
> Every existing surface starts from "John" and finds repos. This one starts
> from a repo and finds people, changes, and gaps.

---

## Shape: own many repos, one tab each

`/own` is a workspace over an explicit, user-chosen set of repos.

```
/own                 index — owned repos, add/remove, at-a-glance strip
/own/[name]          one owned repo, four panels
```

A tab strip across the top of `/own/[name]` switches between owned repos and
stays visible on every panel. Tabs are links, so each repo is bookmarkable and
back/forward works.

**Marking a repo owned** is a single toggle on `/repos` and on `/own` — no
config file to hand-edit. State lives in `.devhub/ownership/repos.json`:

```jsonc
{
  "repos": [
    {
      "name": "capi",
      "fullName": "org/capi",
      "addedAt": "2026-08-11T09:00:00Z",
      "lastVisited": "2026-08-11T09:00:00Z", // drives "since I last looked"
      "domains": null, // null = derive; object = override
      "teams": null, // null = infer; object = override
    },
  ],
}
```

Everything repo-specific is **data in this file**, not code. Adding a second or
fifth owned repo is a toggle, never a commit.

> [!IMPORTANT]
> No plugin is required and none is assumed. Ownership is a core DevHub
> capability. The existing `dashboard.overlays` mechanism means a plugin _can_
> contribute an extra panel later (a runtime/ops card, say), but nothing in the
> core design depends on one existing, and no plugin ships as part of this plan.

---

## What already exists

More than expected. The engine is mostly parts on the floor, not a build from
scratch.

| Need                        | Existing part                                                            | State                                                  |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| PR listing via `gh`         | `lib/github/prs.ts`, `lib/gh-exec.ts`                                    | Queries are `author:@me` / `review-requested:@me` only |
| Which files change together | `lib/git/change-coupling.ts` (+ `git/coupling` route)                    | Complete, 800-commit window, cached 5min               |
| Who touches what            | `lib/people/repo-people.ts`, `lib/github/commit-authors.ts`              | Complete, merges multi-address identities              |
| Commit history parsing      | `lib/repos/git-parsers.ts`, `lib/git/repo-local.ts`                      | Complete                                               |
| Repo discovery + scan       | `lib/repos/index.ts`, `withScannedRepo` in `api/repos/[name]/_shared.ts` | Complete — reuse for `/own` routing and validation     |
| Away digest                 | `lib/since-last-visit.ts` (+ `/api/since`)                               | Exists, but digests DevHub activity, not a repo        |
| Repo health                 | `lib/repos/health.ts`                                                    | Partial — check coverage                               |
| AI summarisation            | `lib/repos/learn-ai.ts`                                                  | Complete, reuse the same model plumbing                |
| Learn pack + cache          | `lib/repos/learn-service.ts`, `learn-cache.ts`                           | Complete, keyed on gitHead                             |
| Nav registration            | `lib/nav.ts`                                                             | Add one entry                                          |
| MCP proxy pattern           | bi: `mcp-servers/devhub-bi-server/`                                      | Reference only — pattern to copy, not a dependency     |

Roughly **60% of the data layer already exists**. The new work is (a) a
repo-scoped PR query, (b) blast-radius scoring, (c) the gap ledger, and (d) the
tabbed shell to hold them.

---

## Layout

All in core. No plugin-specific paths.

```
devhub-private
  app/own/
    page.tsx              index — owned repos, add/remove
    [name]/
      page.tsx
      client.tsx          tab strip + panel layout
      panels/*.tsx
  lib/ownership/
    owned-repos.ts        read/write .devhub/ownership/repos.json
    domains.ts            derive domains for any repo + per-repo override
    teams.ts              CODEOWNERS → org teams → churn inference
    pr-radar.ts           open PRs for a repo, any author
    blast-radius.ts       diff → domains → coupling companions
    gap-ledger.ts         churn × familiarity → ranked learning queue
    obligations.ts        CI, stale branches, bot PRs, unassigned issues
    digest.ts             merged-since-last-visit, AI-summarised
  app/api/own/
    route.ts              GET list / POST add / DELETE remove
    [name]/{prs,blast,gaps,digest,obligations}/route.ts
```

### Domains, without a hand-maintained table

The BI-specific domain map is gone. Domains are derived per repo, in order of
evidence quality:

1. **Workspace definitions** — `package.json` workspaces, `nx.json`, `turbo.json`,
   `go.work`, Cargo workspace members. Where present, this is ground truth.
2. **CODEOWNERS** — path patterns are already a domain partition, and the owning
   team is attached. Best available source when it exists.
3. **Top-level directory heuristic** — `src/*`, `packages/*`, `apps/*`, or repo
   root children, whichever yields a sane count (target 5–20 domains).
4. **User override** — edit and rename domains in the UI; persisted to
   `domains` in `repos.json`.

`lib/git/change-coupling.ts` gives a free sanity check: if two derived domains
are coupled in nearly every commit, they are one domain, and the UI can offer to
merge them.

### Teams, without a hand-maintained table

1. CODEOWNERS team for the touched paths.
2. `gh api /orgs/{org}/teams/{team}/members` where the org exposes it.
3. **Churn inference** — cluster authors by the domains they usually touch.
   Free, needs no org permissions, and good enough to group the radar on day one.

Fall back to "unknown" and group those PRs together rather than guessing.

---

## The panels

Four panels per owned repo. Order below is build order — each is useful alone.

### Panel 1 — Inbound PR radar

**The one that changes your day.** Every open PR targeting the repo, regardless
of author or reviewer.

```
gh search prs --repo <full-name> --state open --json ...
```

`lib/github/prs.ts` already wraps the search API and handles archived-repo
filtering. This is a third query shape alongside `author:@me` and
`review-requested:@me`, not new infrastructure.

Per row:

- author + inferred team (see above)
- age, and **staleness** — open with no review for N days
- files changed → **domains touched**
- **review state**: mine requested / reviewed by someone / nobody looking
- flag: _touches a domain with no CODEOWNER_

Grouped by team by default, because the question is "what is each team doing to
my repo", not "what is the newest PR".

### Panel 2 — Blast radius

Expands a radar row. For the PR's changed files:

- domains reached, ranked by number of files
- **coupling companions** — files that historically change with these but are
  _absent_ from this PR. `suggestCompanions()` in `change-coupling.ts` returns
  exactly this today. The highest-value review signal in the whole page: it
  catches the "they updated the writer but not the reader" class of bug without
  reading a line of the diff.
- historical owners of these files (`repo-people.ts`) → suggested reviewers

### Panel 3 — Knowledge-gap ledger

The learning queue, ranked by evidence rather than by curiosity.

For each domain, score:

```
gap = inbound_churn × (1 − familiarity)
```

- **inbound churn** — commits touching the domain in the last 90 days, weighted
  toward recency, from `git log` (already parsed)
- **familiarity** — commits I authored, PRs I reviewed that touched it, learn-pack
  sections I have opened. Persisted per repo in `.devhub/ownership/<name>.json`.

Output is a short ordered list — _"you are least equipped for the three domains
other teams change most"_ — with a **Learn this** action deep-linking into
`/repos/learn/[name]` scoped to that domain, and a **Generate lab** action
reusing the existing `LabInline` machinery.

> [!IMPORTANT]
> Scope the learn pack by domain. Regenerating the whole pack for one domain is
> the current behaviour and it is why the pack gets read once and never again.

### Panel 4 — Since I last looked

Merged since your last visit **to this repo's tab**, AI-summarised per domain
rather than listed per commit. `lastVisited` is already per-repo in
`repos.json`, so multi-repo works without extra state.

Cache the summary keyed on `(repo, sinceSha, headSha)` — the same pattern
`learn-cache.ts` uses for gitHead. Re-reading the tab must not re-bill the model.

### Obligations strip

Thin, above the panels, one line each with a status dot:

- CI state on the default branch
- stale branches (no commits in 90 days, not merged)
- open dependabot/renovate PRs (a filtered slice of Panel 1's data — free)
- open issues assigned to no one

The `/own` index shows this strip **per owned repo**, so the index alone answers
"is anything on fire" across everything you own.

---

## The MCP layer (phase 6)

Page first, then MCP — but design the libs so MCP is a thin second consumer, not
a rewrite. Every panel's logic lives in `lib/ownership/*`, every route is a thin
handler, and MCP tools proxy the routes the way `devhub-bi-server` does.

A **core** DevHub MCP server, generic over repo:

| Tool                                       | Returns                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `owned_repos()`                            | The repos I own, with obligation status            |
| `repo_owner_brief(repo)`                   | All panels as structured text — "catch me up on X" |
| `repo_pr_radar(repo, team?, since?)`       | Open PRs with blast radius                         |
| `repo_who_owns(repo, path)`                | People + team for a path                           |
| `repo_changed_since(repo, since, domain?)` | Digest                                             |
| `repo_knowledge_gaps(repo)`                | Ranked learning queue                              |

Then:

- **`repo-owner` subagent** — reads the domain map and team table for whichever
  repo it is asked about. One agent, every owned repo.
- **`repo-ownership` skill** — the workflow: triage the radar, decide review vs
  delegate, log the decision to `notes/`.
- **Scheduled morning brief** over `owned_repos` + `repo_owner_brief`, so the
  radar arrives rather than being visited.

---

## Build order

| Phase | Scope                                                                              | Why here                                                         |
| ----- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1     | `owned-repos.ts`, `/own` index, add/remove toggle, `/own/[name]` shell + tab strip | The container. Trivial, and everything else slots in.            |
| 2     | `domains.ts` + `teams.ts`                                                          | Every panel needs the domain partition; build it once, first.    |
| 3     | `pr-radar.ts` + Panel 1 + obligations strip                                        | Standalone value; obligations is a filter over the same data     |
| 4     | `blast-radius.ts` + Panel 2                                                        | Pure reuse of `change-coupling.ts` + `repo-people.ts`            |
| 5     | `digest.ts` + Panel 4, then `gap-ledger.ts` + Panel 3                              | Digest is the easy AI win; the ledger needs familiarity tracking |
| 6     | MCP tools, `repo-owner` agent, `repo-ownership` skill, scheduled brief             | Data model must be stable first                                  |

Mark CAPI owned at the end of phase 1 and use it as the test repo throughout.
Mark a second repo owned before phase 3 ships — multi-repo assumptions rot fast
when only one row exists.

---

## Open questions

1. **Familiarity persistence.** `.devhub/ownership/<name>.json` per repo, or one
   file? Leaning per-repo — it keeps `repos.json` small and hand-readable, and
   familiarity data is the part that grows.
2. **Domain count sanity.** What is the right target band for derived domains,
   and what does the UI do for a repo that yields 200? Probably: derive, then
   collapse by coupling until under ~20, and let the user split back out.
3. **`gh` rate limits.** One radar query per owned repo per refresh. Fine at 3
   repos, questionable at 15 — needs a shared cache and a staggered refresh
   before the index fans out.
4. **Cost ceiling.** Panels 3 and 4 both call the model, now multiplied by repo
   count. Both must be cached on a content hash, and neither may run on tab load
   without a cache hit.
5. **Repos with no local clone.** `withScannedRepo` assumes a local checkout, and
   coupling/churn need one. Does `/own` require a clone, or degrade to
   GitHub-only panels? Leaning: allow it, degrade, and offer a clone button.

---

## Non-goals

- Replacing `/prs`. That surface answers "what is asked of me" and stays.
- A GitHub client. Anything one click away on github.com does not need
  reimplementing — the value here is the _arrangement_, not the data.
- Write actions in phase 1. Read-only until the shape proves out; merging and
  commenting belong on GitHub.
- Shipping a plugin. Ownership is core. A plugin may overlay an extra panel via
  the existing `dashboard.overlays` mechanism, but that is a later, optional
  addition and not part of this plan.
