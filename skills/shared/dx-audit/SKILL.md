---
name: dx-audit
description: Run a developer-experience audit on any repo — dev loop, build/CI/CD, release process, testing, dependency health, architecture drift. Detects the stack and applies stack-specific checks (React Native/Expo, Node/web, etc.). Writes the report to DevHub notes via the notes MCP. Use when DevHub launches a "DX Audit" from the Repos page, or when the user asks to audit developer experience, find dev-time wins, or review why shipping is slow.
metadata:
  short-description: Audit a repo's developer experience
---

# DX Audit

## Overview

Audit a repository for developer-experience friction and shipping speed, then write a
prioritised report to DevHub notes. The output is a decision document, not a lint dump:
every finding needs an impact, an effort estimate, and a concrete next step.

## When To Use

- DevHub launches you from a repo card **DX Audit** button.
- The user asks "why is development slow here", "audit our DX", or "find quick wins".
- A recurring audit is due (compare against the previous `reviews/dx-audit-<repo>-*` note).

## Workflow

1. **Detect the stack.** Read `package.json` / `*.csproj` / `go.mod` / `pyproject.toml`,
   lockfiles, `README`, and CI config. Classify: language(s), framework, build system,
   test runners, release tooling. Pick the matching check module(s) below.
2. **Research the current landscape** (web tools — see Web Research below). After stack
   detection, spend a bounded pass fetching what's true *today*: current stable/LTS
   versions of the repo's core dependencies, what's deprecated or EOL, and the
   ecosystem's current recommended workflow for this stack (e.g. Expo's current guidance
   on dev builds vs Expo Go, EAS Update; the current state of the repo's lint/test
   toolchain). Your training data is stale by definition — verify before you assert.
3. **Map the dev loop.** How does a change get from keystroke to running app? Identify
   every step (install, codegen, native build, bundler, hot reload) and note which are
   slow, manual, or duplicated.
4. **Map the ship loop.** PR → review → CI → merge → release → production. Read the actual
   CI workflow files and release lanes/scripts; don't trust the README's version of events.
5. **Run the check catalogue** (universal + stack modules). For each hit, record:
   what, where (file:line or workflow name), impact (dev-minutes lost or risk), effort
   (S/M/L), and the fix.
6. **Prioritise.** Sort into: Quick wins (S effort, real impact), Strategic bets
   (M/L effort, big payoff), Hygiene (do when passing), Not worth it (name them so the
   debate ends). Cap the report at what a team can act on — 15–25 findings max.
7. **Answer the live question.** If the launch context includes a specific question
   (e.g. "should we use Expo Go or native builds?"), give a direct verdict with reasoning,
   backed by what you found in the repo — not generic advice.
8. **Write the report** to DevHub notes with the notes MCP (`notes_write`).
   Path convention: `reviews/dx-audit-<repo-name>-<YYYY-MM-DD>`. If a previous audit note
   exists, read it first and note what changed since.
9. **Print a terminal summary**: verdict + top 5 actions, one line each. Exit; don't
   leave servers running.

## Web Research

Use your web tools (web search / fetch) for a **bounded** research pass — budget ~5–10
lookups, favouring primary sources:

- **Version currency**: npm registry / GitHub releases for the repo's ~10 most load-bearing
  dependencies; endoflife.date for runtimes (Node, Ruby, Java) and frameworks. Record
  "pinned X, current Y, EOL date Z" — then the staleness findings write themselves.
- **Ecosystem guidance**: the framework's own docs for today's recommended workflow
  (e.g. expo.dev on development builds vs Expo Go, EAS Update; eslint.org on flat config;
  the migration path off deprecated configs like airbnb).
- **Deprecations/abandonment**: for any dependency pinned to an RC/alpha or years-old
  major, check its repo activity — "last release 2022, 400 open issues" is a finding;
  your memory of the project is not.
- **Audit craft**: if unsure how to judge part of the stack, one lookup for current DX/
  audit practice for that ecosystem beats guessing (e.g. current guidance on monorepo
  caching, store-release automation, OTA update strategy).

Rules: primary sources over blog spam; every web-sourced claim in the report carries its
source inline (`[expo.dev]`, `[endoflife.date]`); web facts inform findings but repo
evidence still decides them; if web tools are unavailable, say so in the report and mark
all freshness claims as unverified.

## Check Catalogue — Universal

- **Git hooks**: pre-commit/pre-push running full test suites or full-repo lint (should be
  staged-files only, or moved to CI). Hooks longer than ~10s get skipped with `--no-verify`
  and then lie to everyone.
- **CI shape**: what actually gates a PR vs what could run post-merge or nightly; wall-clock
  of the critical path; caching (deps, build artifacts); `npm ci`/frozen lockfile vs bare
  install; dead/disabled jobs left in config; self-hosted runner bottlenecks.
- **Release process**: manual steps, versions bumped by hand, branch archaeology
  (release/patch/feature branch flows), whether a JS/asset-only change still needs a full
  store release, feature-flag availability vs long-lived feature branches.
- **Dependency health**: majors behind on core deps, deprecated/unmaintained packages,
  RC/alpha versions in production paths, patch files (`patches/`, overrides) and whether
  upstream has since fixed them.
- **Testing**: coverage collected but no thresholds enforced (cost without teeth), snapshot
  sprawl, flaky E2E in the PR gate, test scripts that lie (e.g. `test:file` that runs
  everything).
- **Repo hygiene**: files > 500 lines in hot paths, TODO-disabled infra, docs that
  contradict the scripts, missing typing strategy despite typing tooling installed.
- **Review latency** (process, but visible in git): time from PR open to first review,
  PR size distribution. Suggest CODEOWNERS/auto-assign, draft gating, merge queue,
  smaller PRs — only if the data shows it's a problem.

## Check Catalogue — JS/Node module

- Node version pinning (`.nvmrc`/engines) and whether CI matches local.
- Lockfile discipline; duplicate package managers.
- ESLint/Prettier major-version drift; deprecated shareable configs (airbnb on eslint 8).
- TypeScript adoption: installed-but-unused tooling means paying the cost with no benefit;
  recommend incremental adoption (`allowJs`, new-files-TS) or removal.
- Bundle/build time: measure or estimate; look for missing caches (metro, turbo, webpack).

## Check Catalogue — React Native / Expo module

- **Runtime strategy** — the big one. Identify which of these the repo runs and whether
  it's deliberate: bare RN, Expo dev-client (development builds), Expo Go, CNG/prebuild.
  Rules of thumb:
  - An app with native modules outside Expo Go's sandbox (Firebase, IAP, push vendors,
    audio/video, analytics SDKs) can never converge on Expo Go. Count the `.expo.js`-style
    shim files; each is standing maintenance tax on top of a runtime nobody ships.
  - `expo-dev-client` gives the same JS-only iteration speed as Expo Go with full native
    parity — if it's present, Expo Go is usually redundant, not the future.
  - Checked-in `ios/`/`android/` dirs **plus** Expo config plugins in `app.json` means the
    plugins only apply on prebuild — verify they aren't decorative, and evaluate moving to
    CNG (generated native dirs) to delete native-project maintenance.
  - No `expo-updates`/EAS Update or CodePush equivalent: every JS fix costs a store release.
    This is usually the single biggest ship-speed lever for an RN app.
- New Architecture / Hermes flags consistent across platforms.
- E2E (Detox/Maestro) in the PR gate: build time, flake rate, disabled platforms.
- Store lanes (fastlane/EAS): what's automated vs tribal knowledge; signing (match etc.);
  version bump automation.
- Per-push store uploads from long-lived branches (expensive native builds on every push).

## Report Format (notes_write markdown)

```
# DX Audit — <repo> — <date>
## Verdict            ← 3–6 sentences, incl. answer to any live question
## Quick wins         ← table: finding | impact | effort | fix
## Strategic bets     ← same table
## Hygiene            ← short list
## Not worth doing    ← short list, with why
## Dev loop map       ← keystroke → running app, annotated with timings
## Ship loop map      ← PR → production, annotated
## Previous audit delta  ← only if a prior note exists
## Sources            ← web lookups used, one line each (omit if none)
```

## Rules

- Read the actual configs; never report a finding you can't point to a file for.
- Impact in concrete units where possible ("~4 min per push", "full native build per PR").
- **Measurements vs estimates.** Counts come from commands (`wc -l`, `git ls-files | wc -l`,
  `find ... | wc -l`), never from skimming. A CI `timeout-minutes` is a ceiling, not a
  duration — write "timeout 120 min", not "takes 2 hours". Anything you didn't measure
  gets a `~` and a one-word basis ("~4 min per push, est.").
- **"Checked in" means git-tracked.** A directory existing on disk proves nothing —
  verify with `git ls-files <dir>` before claiming something is committed (build output,
  `vendor/`, caches are usually ignored). Same for sizes: quote git-tracked size
  (`git ls-files -z <dir> | xargs -0 du -ch | tail -1`), never `du -sh` of a working tree
  bloated with ignored Pods/build artifacts.
- **Version-freshness claims need a source.** Your training data goes stale; before
  calling a pinned version "bleeding edge" or "outdated", check the ecosystem's current
  LTS/stable via the Web Research pass (endoflife.date, the package's releases) — cite it,
  or hedge explicitly.
- **One bucket per finding.** Never repeat a finding across Quick wins / Strategic bets /
  Hygiene — pick the bucket that matches its effort and stop.
- **Internal consistency check before writing.** Recommendations must not undermine each
  other (e.g. "remove the unused TypeScript tooling" and "adopt TypeScript incrementally"
  cannot both appear — take one position and defend it).
- A finding without a next step is trivia — cut it.
- Don't recommend a rewrite. Biggest-lever-first, smallest-diff-first.
- If the dashboard/notes MCP is unavailable, write the report to
  `notes/reviews/dx-audit-<repo>-<date>.md` in the DevHub repo and say so.

## Verification

- Confirm the note exists (`notes_read` the path you wrote).
- Terminal summary printed with verdict + top 5 actions.
