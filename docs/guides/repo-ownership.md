---
title: Repo ownership
description: Track repositories you are accountable for — inbound PRs, obligations, knowledge gaps, and catch-up digests.
order: 12
icon: GitPullRequest
tags: [guides, github, repos]
related:
  - architecture/dashboard
  - integrations/github
  - reference/api-routes
---

# Repo ownership

**Own** (`/own`) is a repo-centric workspace for the question "what is happening to code I am accountable for?" It complements **Repos** (clone and edit locally) and **PRs** (your authored and review-requested queue) by focusing on **inbound change** to repositories you mark owned.

The sidebar entry is gated on GitHub (`gh auth login`); it appears once `GET /api/setup/status` reports `github: true`.

## Marking repos owned

| Surface | Action |
| ------- | ------ |
| **Own** index (`/own`) | Enter `owner/repository` and click **Own repo**, or remove with **Stop owning** |
| **Repos** (`/repos`) | Toggle **Owned** on a card when the checkout has a GitHub remote |

Ownership is stored in `.devhub/ownership/repos.json` under the DevHub checkout (`version: 1`, `repos[]` with `fullName` and `addedAt`). You do not need to edit this file by hand. Removing ownership only updates DevHub — it does not change GitHub permissions.

A local clone is helpful for blast-radius and digest panels but not required to list a repo; panels degrade gracefully when the repo is not in the sibling scan directory.

## Index (`/own`)

The index lists every owned repository with a compact obligation strip per card:

- Open inbound PR count
- Obligation cells (branch protection, required checks, stale reviews — tone-coded ok / bad / unknown)
- Attention reasons when something needs a look

`GET /api/own?summary=1` powers this view. Summary data is obligation-level only; full gap scoring and catch-up digests load on the per-repo page.

## Per-repo page (`/own/<owner>/<name>`)

A tab strip switches between owned repos without returning to the index. Each repo page has four panels:

### Obligations

At-a-glance health for repository hygiene — default branch protection, required status checks, and review expectations. Cells use **ok**, **bad**, or **unknown** when GitHub data is unavailable.

### Inbound PR radar

Open pull requests targeting the owned repo, grouped by team. Each row links to GitHub and supports blast-radius lookup for touched paths.

**Domains** partition the repo for gap scoring and path attribution (`lib/repos/domains.ts`):

1. **Overrides** — when `.devhub/ownership/<owner>__<name>.json` defines custom domains.
2. **Workspaces** — `package.json` workspace packages when there are 2–20 of them.
3. **CODEOWNERS** — path prefixes from `.github/CODEOWNERS` / `CODEOWNERS` / `docs/CODEOWNERS`, plus uncovered top-level directories.
4. **Directory scan** — `apps/`, `packages/`, `services/`, or `src/` children when dense enough; otherwise top-level folders (dot-directories and `node_modules` excluded). A **Root** fallback catches unmapped files.

`domainForPath` picks the **longest matching prefix** so `src/api` wins over `src`.

**Teams** resolve in authority order (`lib/ownership/teams.ts`):

| Tier | Source | Notes |
| ---- | ------ | ----- |
| Overrides | `.devhub/ownership/*.json` | Explicit team → domain mapping |
| CODEOWNERS | `@org/team` entries | Bare `@person` owners are individuals, not teams |
| Churn inference | 90-day git history | Authors with ≥40% of commits in one domain; labels prefixed `~` (e.g. `~src/api`) |
| Unknown | — | Single bucket when nothing else matches |

Churn inference needs at least three commits behind a domain before it surfaces a group.

### Knowledge gaps

A ranked queue of domains where inbound churn is high and your familiarity is low. Scores combine path-level change impact with whether you have opened or learned those areas before. **Learn** deep-links into Repo Learning with the domain pre-selected.

Familiarity progress is persisted per repo in `.devhub/ownership/<owner>__<name>.json` (`learned` path → ISO timestamp).

### Catch-up digest

Summarises what landed since your last watermark (or a **Recent** window). Generate a digest, read the markdown summary, then **Mark caught up** to save `headSha` via `POST /api/own/<owner>/<name>/brief`. The watermark prevents re-surfacing the same commits on the next visit.

## API and MCP

| Route | Purpose |
| ----- | ------- |
| `GET/POST/DELETE /api/own` | List, add, remove owned repos |
| `GET /api/own/<owner>/<name>/brief` | Core panels (query `panels=core` for the fast subset) |
| `GET /api/own/<owner>/<name>/gaps` | Knowledge gap ranking |
| `GET /api/own/<owner>/<name>/digest` | Catch-up digest (`?since=recent` optional) |
| `POST /api/own/<owner>/<name>/blast` | Co-change companions and historical reviewers for paths |

MCP tools: `owned_repos`, `repo_owner_brief`, `repo_pr_radar`, `repo_who_owns`, `repo_knowledge_gaps`. See [MCP server — Triage owned repos](../architecture/mcp-server.md#triage-owned-repos-from-an-agent).

## Agents and skills

- **`repo-ownership` skill** (`skills/shared/repo-ownership/`) — workflow for triaging the radar, deciding review vs learn, and recording familiarity.
- **`repo-owner` agent** (`agents/shared/repo-owner.md`) — reads domain maps and team tables for a single owned repo.

## Related surfaces

- **Radar → Dependency divergence** links into owned repos when version skew matters across your estate.
- **Repos** sorts sibling checkouts by recent git activity (`mtimeMs`) so clones you touched lately appear first — separate from ownership, but useful when jumping from Own into local work.

Implementation history and design notes: [Repo ownership plan (archived)](../archive/repo-ownership-plan.md).
