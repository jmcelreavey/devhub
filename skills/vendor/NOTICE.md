# Vendored third-party skills

Everything under `skills/vendor/` is **third-party code**, copied from an
upstream project and redistributed under its own licence. It is *not* covered by
DevHub's MIT licence at the repo root.

## Why this directory exists

DevHub's own skills live in `skills/shared/` and are MIT. Mixing Apache-2.0
skills into that tree would make the licence boundary invisible — you would have
to open each `SKILL.md` to know what you were redistributing. A separate
directory makes the boundary a filesystem fact rather than a frontmatter
detail, and gives `skill-catalog.ts` somewhere to hang a distinct `vendor`
origin so the Skills page can label these honestly.

## Do not edit these in place

Vendored skills are read-only inside DevHub, the same rule that already applies
to plugin and `ai-tools` skills. Local edits get silently clobbered the next
time the skill is re-vendored, and they make the provenance record a lie.

If you need different behaviour:

- **Upstream-worthy fix** → open a PR against the source repo, then re-vendor.
- **DevHub-specific behaviour** → create a skill of the same name in
  `skills/shared/`. Core wins on name collision, so it shadows the vendored one
  and the Skills page marks it `overridesUpstream`.

## Provenance

| Skill | Upstream path | Licence | Author | Version |
|---|---|---|---|---|
| `scope-creep-detector` | `agent_skills/scope-creep-detector` | Apache-2.0 | Matt Van Horn | 1.0.0 |
| `commit-archaeologist` | `agent_skills/commit-archaeologist` | Apache-2.0 | Matt Van Horn | 1.0.0 |
| `project-graveyard` | `agent_skills/project-graveyard` | Apache-2.0 | Shubham Saboo | 1.0.0 |

**Source:** <https://github.com/Shubhamsaboo/awesome-llm-apps>
**Upstream commit:** `3d532f66e525ef440ddde24c001fdb82e9b2bf04`
**Licence text:** [`LICENSE-APACHE-2.0.txt`](./LICENSE-APACHE-2.0.txt)
**Vendored on:** 2026-08-10

The commit is pinned so a re-vendor produces a reviewable diff against a known
point rather than against "whatever `main` was that day".

Each `SKILL.md` retains its upstream `license`, `metadata.author`,
`metadata.version` and `metadata.source` frontmatter. The provenance validator
(`dashboard/lib/skills/provenance.ts`) requires those fields on every skill in
this tree and fails the sync if they are missing.

## Security review

These scripts run with your agent's full permissions — your shell, your files,
your credentials — and DevHub syncs them to every machine you use. They were
reviewed before landing and re-checked on each re-vendor:

- **No network access.** No `urllib`, `requests`, `socket`, `http`, or
  subprocess calls to `curl`/`wget`. Verified by
  `npm run skills:verify-vendor`.
- **No writes to scanned repositories.** Git invocations are read-only
  (`diff`, `log`, `blame`, `ls-files`, `remote`, `config`,
  `branch --show-current`). `project-graveyard` writes only to paths you pass
  explicitly on the command line (`--json`, `--state`), never inside a scanned
  repo. Note that `grep checkout scripts/graveyard.py` looks alarming and is
  not: `checkout` there is a payment-provider keyword used for cause-of-death
  detection, not a git subcommand.
- **Python 3.11 stdlib only.** No third-party imports, so nothing to audit
  transitively and no install step.
- **No install-time execution.** Nothing runs on sync; the scripts only run
  when an agent explicitly invokes them.

Re-run the check after any re-vendor:

```bash
npm run skills:verify-vendor
```

## Re-vendoring

There is no `skills:vendor` script. Copy the upstream skill into
`skills/vendor/<name>/`, update the provenance table above, then re-run:

```bash
npm run skills:verify-vendor
```

Review the diff before committing — an upstream change to a script is a change
to code that runs with your credentials, and it deserves the same scrutiny as
the initial import.
