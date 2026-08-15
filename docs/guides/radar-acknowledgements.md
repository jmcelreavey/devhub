---
title: Radar acknowledgements and dependency divergence
description: Why the drift list stopped repeating itself, and how the Release Radar panel decides what is worth showing.
section: guides
order: 14
icon: Activity
tags: [guides, radar, dependencies]
related:
  - guides/skills
  - architecture/recall
---

# Radar acknowledgements and dependency divergence

Two changes to `/radar`, driven by one complaint: the list never got shorter.

## Marking drift as seen now works

It previously didn't — and not because it was broken. **There was no
acknowledgement mechanism at all.** The page recomputed its diff as *latest
snapshot vs previous snapshot* on every load, with no memory of what you had
already looked at, so a signal that spread months ago kept reappearing until
some later snapshot happened to stop mentioning it. There were 39 drift rows.

### Acknowledgement is a watermark, not a delete

The obvious implementation is a set of dismissed ids. It's wrong in a way that
matters: *"Kubernetes is in 3 of your repos"* and *"Kubernetes is in 11 of your
repos"* are different facts, and silencing the first must not silence the
second — the second is exactly the drift the page exists to surface.

So **Seen** records the magnitude at the time you pressed it:

- The row hides while it stays at or below that level.
- It comes back if it spreads further.
- Nothing is permanently suppressed, so the page is never quietly lying to you.

That's also why the button says *Seen* and not *Dismiss*. A dismiss label
promises permanence the behaviour doesn't have, and the first time a dismissed
row reappeared the control would look broken rather than clever.

Acknowledged rows stay reachable behind **Show N already seen**, with an undo. A
surface that can hide things but not show them again teaches people not to press
the hide button.

### Where it's stored, and why it isn't in the cache

`notes/.radar/acknowledgements.json`.

Three constraints, and only this path satisfies all of them.

**Not `notes/.cache/`.** Everything else the Capability Radar writes is derived
and rebuilds on demand. An acknowledgement is the one piece of genuine user
intent in the feature and cannot be recomputed, so a `Clear cache` must not
discard your triage and flood the page again.

**Under `notes/`,** so it syncs across machines — acknowledging on the laptop
shouldn't leave it unread on the desktop.

**A dot-directory.** The first version used `notes/radar/`, which was wrong
twice: that directory already holds your `personal-radar.md`, and `notes/` is a
*browsable vault* whose indexer and search both read `.json`, so a machine-state
file there would appear in your notes tree as a note called
"acknowledgements". Both walkers skip dot-prefixed names.

Acknowledgements for signals that no longer exist are pruned automatically, so
the file doesn't grow forever and a signal that disappears and returns isn't
suppressed at a watermark nobody remembers setting.

## Capability drift acknowledgements

The capability scan diff (`added`, `spread`, `drift`) uses the same watermark
store and **Seen** / **Undo** controls as Release Radar. Magnitude is repo count:
for `added` and `spread` rows it is `toRepoCount` or `repos.length`; for
`drift` rows it is `repoCount`. A row hides while at or below the acknowledged
count and resurfaces when it spreads further.

`GET /api/capability/radar` partitions each bucket into visible rows plus
`diff.acknowledged` and `acknowledgedCount`. Acknowledge with
`POST /api/radar/acknowledge` using `kind: "capability"` and the signal `id`.

## Dependency divergence

The new panel answers: **where do my repos disagree with each other about a
major version?**

It's **offline** — it compares your repos against each other, not against the
npm registry. Staleness ("is there a newer release upstream") needs an external
current to measure against; divergence needs nothing outside your own repos, and
for a 52-repo estate it's the more actionable signal anyway. The version you
already upgraded somewhere is proof the upgrade is possible, and the panel names
the repo to copy it from.

Registry-backed staleness slots in later as another advisory kind against the
same shape. It isn't here yet for scope reasons, not principle.

### What it found here

```
eslint        24 repos, 4 lines   (10, 9, 8, 7)
typescript    21 repos, 4 lines   (6, 5, 4, 3)
@types/node   16 repos, 6 lines   (26, 24, 22, 20, 18, 14)
dd-trace      15 repos, 3 lines   (5, 4, 1)
```

Expand a row to see which repos are on which line.

### Two tuning decisions, both made from real data

**Ranking is by repos-behind, not by version distance.** Ranking by raw major
distance was the first attempt and it was wrong: `googleapis` ships past v170,
so a routine lag scored a "spread" of 110 and dominated the list, and `expo-*`
packages compare across SDK eras where `0.30` and `57` aren't even the same
numbering scheme. Both are noise with enormous scores. Meanwhile `@types/node` —
a genuine estate problem — sorted ninth. Major numbers simply aren't comparable
across packages. Spread is still shown on the row as context, but no longer
steers the order.

**Defaults are `minRepos: 3` and `minBehind: 2`.** The first run produced 112
rows, which is precisely the unreadable wall this whole change exists to remove.
Two repos disagreeing is usually two unrelated projects rather than an estate
problem, and one straggler is a to-do rather than a pattern. That took it to 46,
with the right ten at the top. Pass `?prodOnly=1` to drop dev-only rows.

### What it deliberately doesn't do

- **No lockfile parsing.** A lockfile says what's *installed*, which is a fact
  about a checkout rather than a decision anybody made, and it drags in
  thousands of transitive packages nobody chose.
- **No `semver` dependency.** The question is which major line a range commits
  to, which needs the leading number. `0.x` is handled as `0.<minor>` because
  `^0.3` and `^0.4` are breaking-incompatible under npm's caret rules — reading
  both as "major 0" would report every 0.x package as falsely aligned.
- **No guessing at unresolvable ranges.** `*`, `1 || 2`, `workspace:*`, a bare
  `>=1` and git URLs name no single line, so they're treated as unpinned rather
  than resolved to a first branch. A repo declaring `1 || 2` hasn't chosen, and
  reporting it as "on 1" would invent a decision to disagree with. A *bounded*
  comparator range like `>=2.0.0 <3` does commit to line 2 and is read as such.

## API

| Route | Purpose |
| ----- | ------- |
| `GET /api/radar/releases?prodOnly=1` | Divergence advisories plus the acknowledged set |
| `POST /api/radar/acknowledge` | `{ kind, id, watermark }` — mark seen |
| `DELETE /api/radar/acknowledge` | `{ kind, id }` — undo |
| `GET /api/radar/acknowledge` | The whole store |

`kind` is `capability` or `release`; both surfaces share one store so they
behave identically. The client sends the watermark rather than the server
recomputing it — you're acknowledging *what you were shown*, and re-deriving
server-side would record a level you never saw if a rescan landed between render
and click.
