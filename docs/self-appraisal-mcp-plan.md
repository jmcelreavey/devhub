# Self-Appraisal Notes — Design Doc & Tool Specs

Status: implemented (initial scaffold landed — see `mcp-servers/devhub-server/src/tools/appraisal.ts` + `appraisal_*` tools in `mcp.ts`, tests in `appraisal.test.ts`)
Owner: JM
Scope: extend the existing `devhub-server` MCP with appraisal-specific tools. No new server, no new storage engine.

## Problem

Performance reviews are written from memory, which means the good stuff — the
gnarly bug, the metric you moved, the thing a teammate thanked you for — is gone
by the time the self-appraisal doc is due. We want a low-friction way to capture
those moments *as they happen* and have them land in a tidy, factual, per-year
note that's actually usable at review time.

The capture has to be cheap (one tool call, mid-conversation) and the note has to
stay disciplined: concise, factual, references attached, no drift into vague
prose or duplicate entries over twelve months.

## Goals (project)

- Capture a noteworthy moment in a single tool call, from any agent session.
- One note per subject per year, auto-created, organised by competency theme.
- Read-modify-write merge — dedup and update in place, never blind-append.
- Every entry carries a reference (PR, ticket, dashboard, thread). No reference,
  no value at review time.
- Track **review goals/objectives** per subject — mutable through the year — so
  the agent can relate captured moments back to what you set out to do.
- Support two **subjects**: yourself (self-appraisal) and other people you
  appraise (direct reports, peers), with the same tooling.
- A year-end tool that drafts the appraisal narrative from notes + goals.

## Non-goals

- No new MCP server or storage backend — reuse `devhub-server` + the vault.
- No web UI work beyond the notes already rendering in the dashboard.
- No automatic "scrape my activity" inference. Capture is intentional.
- No automated ingestion of others' feedback (manager/peer/360) — appraiser
  notes are things *you* record about someone, not a feedback inbox.
- No access control / encryption beyond the repo's existing posture (see
  Privacy).

## Where it lives

Everything hangs off the existing server at
`mcp-servers/devhub-server/src/mcp.ts`, alongside `notes_*`, `docs_*`, `tasks_*`,
and `diagrams_*`. New tools use the `appraisal_*` prefix to match the
`<domain>_<verb>` convention already in place.

Storage uses the existing `NotesStorage` (BlockNote JSON via `jsonVaultCodec`),
so appraisal notes render in the dashboard like any other note for free. No new
codec, no new path helpers.

## Subjects (self and others)

A **subject** is who an entry/goal is about:

- `self` — your own appraisal. The default for every tool when `subject` is
  omitted, so the self-appraisal path stays a single-arg call.
- a **person slug** — someone you appraise, e.g. `jane-doe`. Used when you're the
  appraiser writing about a report or peer.

`subject` is a parameter on every tool, defaulting to `self`. It routes to a
different file but otherwise behaves identically — same themes, same entry
format, same goals model. Person slugs are `slugify(name)`; a small
`appraisal_people` listing tool surfaces which person files exist so you don't
have to remember slugs.

## Storage layout

```
notes/
  appraisal/
    self/
      2026.json
      2025.json
    people/
      jane-doe/
        2026.json
      sam-okafor/
        2026.json
```

`VaultStorage.write` creates directories on first write, so no bootstrap step is
needed. Path resolution reuses `NOTES_DIR`; the year file is derived from
subject + entry date: `appraisal/self/<YYYY>` or
`appraisal/people/<slug>/<YYYY>`.

Because these live under `notes/`, decide one scope detail up front (see Open
questions): whether `appraisal/` should be included in `notes_search` /
`notes_list`. Default recommendation: keep it out of the default workspace
listing (like `learnings/`) and reach it through the dedicated `appraisal_*`
tools, so day-to-day note listings stay clean.

## File format

Stored as BlockNote blocks, but authored and round-tripped as Markdown via the
existing `textToBlocks` / `blocksToText` pipeline (`shared/markdown-convert`).
The canonical Markdown shape of a year file:

```markdown
# Self-Appraisal 2026

## Goals
### Ship the new matching pipeline to GA
Status: active · set 2026-01-12 · updated 2026-04-02
Own the rollout end-to-end; success = GA with <1% error rate.
Revised 2026-04-02: scope trimmed to EU region first.
<!-- goal: ship-matching-pipeline-ga -->

### Mentor two engineers to mid-level
Status: achieved · set 2026-01-12 · updated 2026-05-30
<!-- goal: mentor-two-to-mid -->

## Impact
### Cut CI pipeline time 22→9 min
2026-06-17 — Parallelised test shards across 4 runners; team feedback loop ~60%
faster. Refs: [PR #1843](https://github.com/...), [CI dashboard](https://...)
Goal: ship-matching-pipeline-ga · Tags: #performance #ci
<!-- id: cut-ci-pipeline-time -->

## Technical
### ...

## Collaboration
### ...

## Growth
### ...
```

Rules the tools enforce:

- A `## Goals` section sits above the themes. Each goal is an `###` heading (the
  goal title) with a `Status: …` line, optional body, optional `Revised <date>:`
  lines recording changes, and a hidden `<!-- goal: <slug> -->` marker.
- Goal status is one of **active**, **revised**, **dropped**, **achieved**.
  Goals are mutable; revisions append a dated `Revised:` line rather than
  overwriting history, so you can see how the goal moved through the year.
- Four fixed top-level themes: **Impact**, **Technical**, **Collaboration**,
  **Growth**. An entry always lands under exactly one.
- Each entry is an `###` heading (the title) followed by one short paragraph:
  `DATE — what happened; impact/evidence. Refs: [...]` then an optional
  `Goal: <slug> · Tags: …` line linking the moment to a goal.
- Entries and goals each end with a hidden marker (`<!-- id: <slug> -->` /
  `<!-- goal: <slug> -->`). The slug is the dedup/update key — derived from the
  title but stored explicitly so a later title tweak doesn't fork it.
- Body kept to ~1–3 sentences. The tool truncates/flags anything longer to keep
  notes scannable.

The hidden-marker approach means update-in-place is a deterministic string
operation on the round-tripped Markdown — no fragile heading matching, and it
survives the blocks↔markdown conversion since it's just text.

## Tools

### `appraisal_record`

The primary capture tool. Structured input so entries stay uniform; the calling
agent supplies the fields, the tool owns file resolution, dedup, and placement.

```ts
inputSchema: {
  subject:    z.string().optional().describe("'self' (default) or a person name/slug you appraise"),
  title:      z.string().describe("Short entry title, e.g. 'Cut CI pipeline time 22→9 min'"),
  theme:      z.enum(["impact", "technical", "collaboration", "growth"]),
  summary:    z.string().describe("1-3 factual sentences: what happened + impact/evidence"),
  references: z.array(z.string()).min(1).describe("URLs or refs: PR, ticket, dashboard, thread. At least one required."),
  goal:       z.string().optional().describe("Slug of a goal this moment advances (see appraisal_set_goal)"),
  tags:       z.array(z.string()).optional().describe("Competency tags, e.g. ['leadership','mentoring']"),
  date:       z.string().optional().describe("YYYY-MM-DD. Defaults to today; also selects the year file."),
  id:         z.string().optional().describe("Explicit dedup slug. Defaults to a slug of the title."),
}
```

Behaviour:

1. Resolve subject (default `self`) + year from `date` (default today) → the
   year file for that subject.
2. Read existing note (or start a skeleton with the goals + four theme headings).
3. Compute `slug = id ?? slugify(title)`.
4. If an entry with that slug exists: update its title/summary/refs/goal/tags/date
   in place, preserving its theme unless `theme` changed (then move it). Else:
   insert a new `###` entry under the chosen theme.
5. Write back. Return `Recorded` / `Updated` + the path and slug.

`references` is `min(1)` on purpose — the schema makes "factual with references"
non-optional rather than a guideline. `goal` is validated against existing goal
slugs for that subject/year; an unknown slug is rejected with the list of valid
ones so the agent can correct it.

### `appraisal_set_goal`

Create or revise a review goal/objective for a subject. Goals are mutable — call
it again with the same slug to update status or append a revision.

```ts
inputSchema: {
  subject:     z.string().optional().describe("'self' (default) or a person name/slug"),
  title:       z.string().describe("Goal title, e.g. 'Ship the new matching pipeline to GA'"),
  detail:      z.string().optional().describe("What success looks like; 1-2 sentences"),
  status:      z.enum(["active","revised","dropped","achieved"]).optional().describe("Default 'active'"),
  revision:    z.string().optional().describe("Note describing what changed; appended as a dated 'Revised:' line"),
  year:        z.string().optional().describe("YYYY. Defaults to current year."),
  id:          z.string().optional().describe("Explicit goal slug. Defaults to a slug of the title."),
}
```

Behaviour: resolve subject/year file; if the goal slug exists, update its status
and append a dated `Revised: <revision>` line (history preserved); else create it
under `## Goals`. Returns the goal slug so `appraisal_record` can reference it.

### `appraisal_list_goals`

```ts
inputSchema: {
  subject: z.string().optional(),
  year:    z.string().optional(),
  status:  z.enum(["active","revised","dropped","achieved"]).optional().describe("Filter by status"),
}
```

Lists goals for a subject/year with their status and revision history. The agent
calls this before recording so it can suggest linking a moment to a live goal,
and the `summarize` tool uses it to frame achievements against objectives.

### `appraisal_people`

Lists which person subjects have files (slugs + entry/goal counts per year), so
you can appraise others without remembering exact slugs.

### `appraisal_read`

```ts
inputSchema: {
  subject: z.string().optional().describe("'self' (default) or a person name/slug"),
  year:    z.string().optional().describe("YYYY. Defaults to current year."),
  theme:   z.enum(["impact","technical","collaboration","growth"]).optional(),
  tag:     z.string().optional().describe("Filter to entries carrying this tag"),
  goal:    z.string().optional().describe("Filter to entries linked to this goal slug"),
}
```

Returns the year note (goals + entries) as Markdown, optionally filtered to a
theme, tag, or goal — e.g. pull every `#leadership` entry when the review form
asks about leadership, or every moment tied to a given objective.

### `appraisal_list`

Lists available year files (across `self` and people) with entry counts per
theme and goal counts. Cheap orientation tool so the agent knows what exists
before reading.

### `appraisal_summarize`

```ts
inputSchema: {
  subject: z.string().optional().describe("'self' (default) or a person name/slug"),
  year:    z.string().optional(),
  theme:   z.enum([...]).optional(),
  style:   z.enum(["bullets","narrative"]).optional().describe("Output shape, default narrative"),
}
```

Reads the year file (entries + goals) and returns a drafted appraisal write-up
grouped by theme, with achievements framed against the subject's goals and each
claim backed by its references. This is the payoff tool at review time — works
for `self` (your self-appraisal) and for a person (your write-up as their
appraiser). The drafting is done by the calling agent from the structured note;
the tool assembles and hands back source material in a review-ready shape and
does not invent un-referenced claims.

### `appraisal_delete` (optional)

Delete an entry by `subject` + `year` + `id` slug. Low priority; included for
symmetry and to fix mistaken captures. (Goal deletion is intentionally omitted —
dropped goals are kept with `status: dropped` to preserve the year's history.)

## Merge / dedup algorithm

```
record(entry):
  subject = entry.subject ?? "self"
  year    = (entry.date ?? today).year
  file    = subjectYearPath(subject, year)   # appraisal/self/<year> or appraisal/people/<slug>/<year>
  md      = blocksToText(read(file)) or skeleton()   # skeleton = ## Goals + 4 theme headings
  slug    = entry.id ?? slugify(entry.title)
  if entry.goal and entry.goal not in goalSlugs(md): reject(validGoals(md))
  block   = renderEntry(entry, slug)   # ###, paragraph, goal+tags line, <!-- id --> marker

  if md contains marker(slug):
    md = replaceEntryBlock(md, slug, block)   # update in place
    if theme changed: move block to the new theme section
  else:
    md = insertUnderTheme(md, entry.theme, block)

  write(file, textToBlocks(md))
```

Goals use the same pattern keyed off `<!-- goal: slug -->`: `set_goal` slices the
goal's `###` block, updates its `Status:` line and appends a dated `Revised:`
line, or inserts a new goal under `## Goals`. `replaceEntryBlock` /
`replaceGoalBlock` key off the hidden markers, slicing from the `###` heading to
the marker. Deterministic, conversion-safe, no NLP required for dedup.

## Year rollover

No cron, no special-casing. The year is always derived from the entry date, so
the first capture of a new year creates that year's file automatically. Capturing
something retroactively (`date` in a prior year) routes to the correct file.

## Edge cases

- **No references supplied** → schema rejects (`min(1)`). The agent must attach
  at least one or the call fails loudly.
- **Over-long summary** → tool truncates to a sentence cap and notes it in the
  response so the caller can tighten it.
- **Title changes on an existing entry** → caller passes the original `id` slug;
  title updates without forking. Without the slug, a renamed title creates a new
  entry (acceptable, documented).
- **Theme change** → entry is moved to the new section, not duplicated.
- **Concurrent writes** → reuse the vault's existing `writeAtomicNow`; last write
  wins, which is fine for single-user capture.
- **Empty/new year** → `appraisal_read` returns the skeleton (`## Goals` + four
  empty theme headings) rather than "not found", so the structure is discoverable.
- **Entry links an unknown goal** → rejected, with the valid goal slugs returned
  so the agent can pick one or call `appraisal_set_goal` first.
- **Goal revised mid-year** → `set_goal` appends a dated `Revised:` line and flips
  `Status:`; prior wording is preserved, so the history of the objective stays
  legible at review time.
- **New person subject** → first `record`/`set_goal` with a person `subject`
  slugifies the name and creates `appraisal/people/<slug>/<year>` automatically;
  `appraisal_people` then surfaces it.
- **Same display name, different people** → slug collision; caller disambiguates
  by passing an explicit slug (e.g. `jane-doe-eng`). Documented, not auto-solved.

## Privacy

Appraiser notes are about *other people*, so they're more sensitive than
self-notes. Decision: they're treated as **syncable notes** — committed and
pushed via the normal notes-sync flow, and surfaced as "notes" (not generic
"dirty changes") in the dashboard top bar, because they live under `notes/`
(`app/api/status/git/route.ts` buckets by path prefix). No new access control.

- Person files sit under `appraisal/people/` and are git-tracked like anything
  else in `notes/`. If this repo is shared or pushed, those notes go with it.
- They're already excluded from default `notes_search`/`notes_list`
  (`isWorkspaceNoteRel` only scopes root + `daily/`), so other-people notes don't
  surface in unrelated note browsing.
- If stronger isolation is wanted later, options (out of scope here): a
  `.gitignore` entry for `appraisal/people/`, or a separate `APPRAISAL_DIR`
  env-routed vault outside the tracked tree. Flagged so it stays a deliberate
  choice, not an accident.

## Dashboard integration

None required to ship. Because notes are stored under `notes/` as BlockNote
JSON, the year files appear and render in the existing notes UI. A later nicety
(out of scope): a dedicated `/appraisal` view with a subject switcher (self vs
people), a goals panel, and theme/tag filters.

## Testing

- Unit: `slugify`, `renderEntry`, `renderGoal`, `replaceEntryBlock`,
  `replaceGoalBlock`, `insertUnderTheme`, skeleton generation — pure
  string/markdown functions, easy to cover.
- Round-trip: `record` → `read` returns the entry; `record` same slug → one
  entry, updated; `record` with new theme → moved not duplicated.
- Goals: `set_goal` creates then revises (status flips, `Revised:` line appended,
  prior text intact); `record` linking an unknown goal is rejected.
- Subjects: `subject:'self'` and `subject:'Jane Doe'` route to different files;
  `appraisal_people` lists the person.
- Schema: missing `references` rejected; bad `theme`/`status` rejected.
- Year routing: a `date` in 2025 writes the 2025 file, today writes 2026.

Mirror the existing `devhub-server` test style (the markdown-convert and vault
helpers already have coverage to follow).

## Implementation steps

1. Add the tools to `mcp-servers/devhub-server/src/mcp.ts`: `appraisal_record`,
   `appraisal_read`, `appraisal_list`, `appraisal_people`, `appraisal_set_goal`,
   `appraisal_list_goals`, `appraisal_summarize` (and optional
   `appraisal_delete`).
2. Add a small `appraisal.ts` helper module next to `convert.ts` for
   `slugify`, `subjectYearPath`, `renderEntry`, `renderGoal`, `replaceEntryBlock`,
   `replaceGoalBlock`, `insertUnderTheme`, and skeleton generation. Keep all
   markdown-munging there; the tool handlers stay thin.
3. Search/list scope: **already handled** — `isWorkspaceNoteRel`
   (`shared/notes-search/scope.ts`) only includes root files + `daily/`, so
   `appraisal/` is automatically excluded from `notes_search`, and
   `filterAgentNoteTree` keeps it out of `notes_list`. No change needed. The
   privacy posture for `appraisal/people/` (gitignore vs separate vault) is still
   an open decision.
4. Tests per above.
5. Update `docs/architecture/notes-system.md` with the appraisal tools, the
   subject/year file layout, and the goals model.

## Open questions

1. **Themes** — are Impact / Technical / Collaboration / Growth the right four,
   or should they map to your actual review rubric's competencies? Easy to swap;
   they're a single enum + the skeleton. (Could also differ for self vs people.)
2. **Search scope & privacy** — keep `appraisal/` dedicated-tools-only
   (recommended), and should `appraisal/people/` be git-ignored or routed to a
   separate vault outside the tracked tree?
3. **Summarize ownership** — should `appraisal_summarize` return structured
   source for the agent to write up (recommended, deterministic), or attempt the
   prose itself?
4. **Goal scope** — goals are per-year here. Do you want multi-year /
   carry-over goals (an objective that spans review cycles), or is annual the
   right boundary? Annual keeps routing simple; carry-over needs a copy-forward
   step at year start.
