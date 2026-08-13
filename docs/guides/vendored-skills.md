---
title: Vendored skills
description: Third-party skills under skills/vendor — what they do, how to run them, and the licence and security rules that keep them safe to sync.
section: guides
order: 13
icon: PackagePlus
tags: [guides, skills, security]
related:
  - guides/skills
  - contributing/recording-demos
---

# Vendored skills

Third-party skills copied into `skills/vendor/` from upstream projects, under
their own licence. Three are installed today, all Apache-2.0 from
[awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps).

They sync to your tools exactly like the skills in `skills/shared/` — ask your
agent for them by name or describe the problem, and it loads the right one.

---

## The skills

### `scope-creep-detector` — before you open a PR

![scope-creep-detector finding four files that overran a one-line intent](../assets/demos/scope-creep-detector.gif)

Compares a diff against a one-line statement of what you meant to do, then
classifies every changed file as in-scope or likely creep, flagging new
dependencies, public API renames, config/CI edits, oversized hunks and
formatting-only churn.

> "Check whether this branch grew beyond fixing the calendar timezone bug."

Directly:

```bash
python3 skills/vendor/scope-creep-detector/scripts/scope_creep.py \
  --repo . --base main --intent "fix calendar timezone offset" --json
```

Works on the working tree (default), `--staged`, `--base <branch>`, a saved
`--diff file.patch`, or a diff on stdin with `--diff -`.

**Read the relatedness score as triage, not proof.** It is keyword overlap
between your intent and each file path — a cheap deterministic proxy. A zero
score often means a vague intent or an indirect-but-necessary file. The skill
tells the agent to verify before recommending a split, and you should hold it
to that.

Pairs naturally with the existing `create-pr` and `pr-explain-review` skills:
scope first, then write the description.

### `commit-archaeologist` — why does this code exist?

![commit-archaeologist reconstructing a file's history, including a reverted workaround](../assets/demos/commit-archaeologist.gif)

`git blame` names whoever last touched a line. This reconstructs *why the line
exists*: the introducing commit, what changed after, which files repeatedly
change alongside it, and intent clues (reverts, workarounds, "temporary",
issue refs) pulled from commit messages.

> "Why does the atomic-write mutex in lib/atomic-write.ts exist? Check the history
> before I refactor it."

Directly:

```bash
# Whole file
python3 skills/vendor/commit-archaeologist/scripts/archaeologist.py . lib/atomic-write.ts --json

# Just a region, by current line numbers
python3 skills/vendor/commit-archaeologist/scripts/archaeologist.py . lib/atomic-write.ts --lines 40-72 --json
```

Output feeds naturally into `notes/learnings/` — an archaeology report on code
you're about to change is exactly the kind of thing the learnings tier exists to
hold.

**Line mode and file mode answer different questions.** Line mode traces the
commits that shaped the *current* selected lines and can start long after the
file was created; file mode follows the whole file through renames. When an
origin looks suspiciously recent, check both.

### `project-graveyard` — what did I abandon, and why?

![project-graveyard reporting causes of death across four projects](../assets/demos/project-graveyard.gif)

Scans for dead repos, works out a cause of death from each one's git history,
surfaces your patterns across all of them, and picks the one worth reviving.

> "Run the graveyard over ~/Developer."

Directly:

```bash
python3 skills/vendor/project-graveyard/scripts/graveyard.py ~/Developer --days 45
```

**Use the wrapper.** A plain run reports `not yours (skipped): 10` and finds
nothing, which reads like a broken tool:

```bash
scripts/graveyard.sh                     # scans REPO_ROOT, claims every identity
scripts/graveyard.sh --days 90 --redact  # flags pass through
```

There are two separate causes for that empty report, and only one is the
wrapper's to fix.

*Multiple identities* — the scanner matches commit emails against your git
identity, so committing under both a personal and a work address disowns half
your history. The wrapper derives them (global identity plus every repo's local
`user.email`) and passes each as `--me`, so adding a new work identity fixes
itself.

*Authorship share* — even with every identity claimed, shared work repos still
skip. The scanner also drops repos where you wrote under ~20% of commits, on
the reasoning that a checkout you contribute to isn't a side project you
abandoned. Here `capi` is 256 of 1428 commits — 18%, just under the line. That
default is right for the question this skill asks, so the wrapper leaves it
alone. Pass `--include-foreign` when you want them; they mostly return
classified as *finished* rather than dead, which is the honest answer for a
shipped, stable service.

Other flags worth knowing: `--max N` (default 60 repos), `--redact` (swaps
project names for `project-1..n` if you want to share a report), `--json PATH`,
and `--state FILE` to enable relapse tracking across runs.

---

## Why these live apart from `skills/shared/`

Everything in `skills/shared/` is yours and MIT with the repo. These are not.
Mixing them into one tree would make the licence boundary invisible — you would
have to open each `SKILL.md` to know what you were redistributing. A separate
directory makes it a filesystem fact, and gives the catalog somewhere to hang a
distinct `vendor` origin so the Skills page can label them honestly.

Full provenance, the pinned upstream commit and the security review are in
[`skills/vendor/NOTICE.md`](../../skills/vendor/NOTICE.md).

## Precedence

```
skills/shared  >  skills/vendor  >  ai-tools  >  plugins
```

First match wins. Vendor sits directly below core, which is what makes
overriding possible.

## They are read-only — override, don't edit

Editing a file under `skills/vendor/` is silently discarded on the next
re-vendor, and it makes the provenance record a lie. Two supported routes:

1. **Upstream-worthy fix** → PR against the source repo, then re-vendor.
2. **DevHub-specific behaviour** → create a skill with the *same name* in
   `skills/shared/`. Core wins, so it shadows the vendored one and the Skills
   page marks it `overridesUpstream`.

`Collect Skills` also knows about vendored names and will not copy them back
into `skills/shared/` — that would fork them from upstream and quietly
relicense Apache-2.0 code into the MIT tree.

## The security gate

These scripts run with your agent's full permissions — your shell, your files,
your credentials — on every machine DevHub syncs to. So the claims in NOTICE.md
are checked by code, not by memory:

```bash
npm run skills:verify-vendor
```

It asserts every vendored skill declares `license`, `author`, `version` and
`source` in frontmatter, and that no script imports networking modules, calls
`urlopen`, shells out to `curl`/`wget`, or pulls in anything outside the Python
stdlib. `lib/skills/vendor-audit.ts` holds the logic and is unit-tested,
including against the real vendored scripts.

**It is a grep, not a sandbox.** A script determined to hide a network call —
base64, `getattr` indirection, an exotic shell-out — will get past it. It raises
the floor. On re-vendor, still read the diff: an upstream change to a script is
a change to code that runs with your credentials.

## Evals — proving they still work

`skills:verify-vendor` proves the scripts *can't* reach the network. It says
nothing about whether they still **work**. A re-vendor that quietly breaks
rename-following in the archaeologist, or drops the payments-wall cause from the
graveyard, passes every other check in this repo.

`dashboard/lib/skills/vendor-evals.test.ts` runs each script against a synthetic
repository and asserts on its JSON. They're vitest files, so they run in
`npm test` and in CI with no extra wiring:

```bash
npm test --prefix dashboard -- lib/skills/vendor-evals.test.ts
```

They need `python3`. Without it they **skip rather than fail** — the vendored
skills are Python, DevHub isn't, and a contributor shouldn't get a red suite
they can't act on.

### The fixture

```bash
python3 scripts/skill-evals/build-fixture.py /tmp/devhub-skill-fixture
```

Builds three repositories and prints a JSON summary of what was planted. Every
signal the evals assert on was put there deliberately — "does it find the
revert" is only answerable if you planted a revert.

| Repo | Exercises | Plants |
| ---- | --------- | ------ |
| `archaeology-repo` | `commit-archaeologist` | issue ref, revert, workaround marked temporary, a companion file that co-changes, a second author whose only commit was reverted |
| `scope-repo` | `scope-creep-detector` | a branch whose intent is "fix cache expiry" that also adds a dependency, renames a public function, edits CI, and touches billing |
| `graveyard/` | `project-graveyard` | a long-lived corpse, a one-day burst, one that died at the payments wall, and one still active |

Commits pin author, email and both date fields, so the same inputs produce the
same commit hashes on every machine. Dates count backwards from a fixed epoch
rather than `now()`.

**One deliberate exception:** the `still-alive` repo is dated relative to
`now()`. `project-graveyard` measures silence against wall-clock time, which no
fixture can pin — an epoch-relative "alive" repo is alive the day you write it
and a corpse forever after. That's not hypothetical; the first draft of this
fixture reported `still-alive` as dead.

**Assertions are loose about ordering and exact counts** on purpose. These are
third-party heuristics, not our invariants. Pinning `co_changed[0].count === 4`
turns a harmless upstream tweak into a red build and trains everyone to skip the
failure. Each test asserts the property the skill *claims*.

The fixture is also the safe data source for demo recordings — no real project
names, commit subjects or author emails, so a recording made against it is
publishable without redaction. A demo is an eval you can watch.

### Demos

The GIFs above are recorded against the same fixture:

```bash
npm run skills:demos
```

Tapes live in `scripts/skill-evals/demos/`. The script builds a throwaway
fixture first and refuses to run without it — **never point these at a real
projects directory**. `project-graveyard` names abandoned projects and reads
commit emails; `commit-archaeologist` prints commit subjects and author
addresses. Making the safe path the only path is cheaper than remembering to
redact.

Three things that cost time, recorded so they don't cost it twice:

- **`Sleep 1600` means 1600 *seconds*.** VHS defaults to seconds with no unit,
  so a tape meant to pause 1.6s takes 26 minutes and looks like a hang. Always
  write `Sleep 1600ms`.
- **`Output` must be quoted.** An unquoted path is parsed as a command and the
  tape fails at parse time.
- **`vhs` exits 0 when ffmpeg could not open the output file.** A relative
  `Output` resolves against the *caller's* working directory, not the tape's, so
  running a tape by absolute path silently writes nothing. `record-demos.sh`
  therefore `cd`s to the tape directory and checks the artefact exists rather
  than trusting the exit code.

## Adding or updating a vendored skill

```bash
# Fetch just the skill you want
cd /tmp && git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Shubhamsaboo/awesome-llm-apps.git vendor-src
cd vendor-src && git sparse-checkout set --skip-checks agent_skills/<skill> LICENSE

# Review before it lands — this is the step that matters
grep -nE "^\s*(import|from) " agent_skills/<skill>/scripts/*.py
grep -nE "urllib|requests|socket|urlopen|curl|wget" agent_skills/<skill>/scripts/*.py

# Copy in, then gate
cp -r agent_skills/<skill> ~/Developer/devhub-private/skills/vendor/
cd ~/Developer/devhub-private && npm run skills:verify-vendor
```

Then update the provenance table and pinned commit in
`skills/vendor/NOTICE.md`, and add the `vendored:` marker to the skill's
frontmatter metadata.

Note that `grep checkout scripts/graveyard.py` looks alarming and isn't:
`checkout` there is a payment-provider keyword used for cause-of-death
detection, not a git subcommand. Its actual git usage is `log`, `ls-files`,
`remote` and `config` — all read-only.
