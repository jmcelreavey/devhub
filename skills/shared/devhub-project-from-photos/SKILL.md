---
name: devhub-project-from-photos
description: Turns user project photos and a stated goal into a beginner-friendly DevHub note with embedded images and a folder-scoped linked master checklist. Use when the user sends site photos and asks for garden, home, yard, or DIY project plans, supplies lists, or step-by-step how-to notes with shared checklists.
metadata:
  short-description: Project note from photos
---

# DevHub Project From Photos

## Overview

Create or update a **project note** under `notes/<folder>/` from photos plus a plain-language goal (e.g. “make a flower bed”, “fix a leaking tap”). The note should read like a **todo guide**, not a project explanation: checklist first, compact reference sections in toggles, then a clear working guide made of checkbox items written for someone with **zero prior experience**. Supplies and tools must use a **linked shared checklist** tied to the folder’s **master checklist** in `collections/` so items are deduped and ownership (`checked`) stays consistent across projects.

## When To Use

- User attaches photos of a site, room, yard, or problem area.
- User describes what they want to accomplish and wants it saved in DevHub notes.
- User mentions supplies, tools, shopping list, or “what do I need” alongside a project.
- User references garden, home, house, yard, or generic DIY work (not only garden).
- User sends finished/completion photos for an existing project note and wants the note updated or archived.

## Prerequisites

- DevHub **notes MCP** configured (`mcp/shared/notes.json`). Load [devhub-notes-mcp](../devhub-notes-mcp/SKILL.md) for tool usage; do not duplicate full schemas here.
- For checklist updates when the dashboard is running: `PATCH /api/collections/<id>` (preferred). Otherwise edit `collections/<id>.json` carefully.

## Inputs

Infer project title from the user’s goal when they do not name one.

## Workflow

Pick one based on note state and the user's intent:

- **No note exists yet, or user is starting fresh** → [Create a project note](#create-a-project-note).
- **Note exists and user is mid-project** (progress photos, "I've done X", "review and update my existing notes") → [Update an in-progress project](#update-an-in-progress-project). **This is the default for any update request — do not bolt a "Progress update" toggle on top of an unchanged Guide.**
- **Project is finished** (completion photos, "we're done", "archive this") → [Complete and archive a project](#complete-and-archive-a-project).

### Create a project note

#### 0. Discovery questions (before you plan)

Ask short questions when answers would change materials, safety, or steps. Use `AskQuestion` when available; otherwise ask in chat as a numbered list (max **6** questions, one message).

**Ask when missing or unclear:**

| Topic | Why it matters |
| ----- | -------------- |
| Notes folder (`garden`, `home`, …) | Master checklist scope and note path |
| End goal in one sentence | Scope (repair only vs full replace, paint color, “make it safe” vs “make it pretty”) |
| Size / extent | Length of damaged area, number of panels, gate involved |
| DIY vs professional help | Whether to include “call a pro” steps or skip advanced work |
| Tools already owned | Mark master items `checked: true` only when the user confirms ownership |
| Budget or “good enough” vs “long lasting” | Cheapest fix vs replace rotten wood, primer, two coats |
| Access and timing | Working on driveway/public edge, need dry weather for paint |
| Constraints | Rental property, HOA color rules, neighbors, pets, children |
| **Location (postcode or town)** | Local supplier recommendations (`## Where to buy (near you)`) |
| Already-owned materials | Master checklist `checked: true` |
| Salvage / reuse likely | First Guide step and lower cost estimate |
| Schedule pressure | Shorter calendar plan vs comfortable multi-weekend plan |

**Skip or shorten discovery when:**

- Photos plus the user’s message already answer most of the above.
- The user says “just do it” or “use your best judgment” — then keep assumptions short inside the `Before you start` or `Planning notes` toggle.

Do **not** block on every question; after one round (or a clear “go ahead”), proceed with the workflow.

**In the note:** do not create long “what you told us” or “assumptions” explanation sections. Put only useful context in the compact toggles.

#### 1. Resolve the folder master checklist

1. Read `collections/*.json` (or `GET /api/collections`).
2. Find the master where `scopePath` equals the notes folder (longest-prefix rules apply for nested notes; see `dashboard/lib/checklists/paths.ts`).
3. If missing, create one:
   - **Preferred:** `POST /api/collections` with `{ "name": "<Folder>", "scopePath": "<folder>", "icon": "..." }`.
   - **Fallback:** new `collections/<uuid>.json` with `schemaVersion: 2`, matching existing files.
4. Record `masterId` for the linked block.

#### 2. Analyze photos

From each image, note: subject, scale, constraints (slope, access, damage), safety hazards, and anything that changes the plan. Use this in `Reference images`, `Planning notes`, and the Guide checklist items.

#### 3. Local suppliers (when location is known)

When the user gives a **postcode, town, or “near me”** (or it is on their profile):

1. **Search** for builders merchants, timber yards, and DIY stores that stock what the project needs (timber, fencing, paint, post mix, tools).
2. **Radius:** default **15 miles** unless the user specifies otherwise.
3. **Prefer** places that clearly stock **timber / fencing / paint** (not only general grocery).
4. Include **2–4 options**, nearest and most relevant first. For each:
   - Name, town, postcode if known
   - Phone and website (when found)
   - **What to buy there** for this project (one line)
   - Rough distance only if the source states it; do not invent miles
5. If search results are thin, say so and suggest the user phone ahead with a shopping list.
6. Put this near the top in a collapsed toggle named **`Where to buy`** so it is easy to find without pushing the work guide down.

Do not fabricate store names, addresses, or phone numbers.

#### 4. Cost and time estimates

When the user has enough scope (measurements, counts, or photos plus goal):

1. Build a **materials cost** range in the user’s local currency (UK: GBP). Use web search or known merchant ballparks when helpful; always label as **rough** and suggest phoning ahead.
2. Split totals when salvage/reuse is likely: “if you buy everything” vs “if you reuse what’s sound”.
3. Subtract or call out items the user **already owns** (tools, spare posts, leftover paint).
4. Estimate **active labour time** for one beginner (hours) and **calendar time** (days/weeks including concrete cure and paint drying). Use a short phase table: phase | active time | wait time.
5. Put both in a collapsed **`Cost and time`** toggle (after Checklist, before or after `Where to buy`). Omit only if the user explicitly does not want estimates.

Do not invent exact shop prices; ranges are fine. Do not promise professional quotes.

#### 5. Build supplies and tools (master + note links)

For each item needed for **this project only**:

1. **Normalize** the name (trim, single spaces, case-insensitive match).
2. **Reuse** an existing master item → capture its `id` for `entriesJson`.
3. **Add** via `PATCH` `{ "action": "promoteItem", "name": "...", "checked": false }` unless the user said they already own it (`checked: true`).
4. **Never** set an existing `checked: true` item to `false`.
5. Optional `notes` on the master item for quantity/size (e.g. “2 bags”).

Direct JSON fallback: merge new items with new UUIDs; duplicate names must reuse the same item id (same rules as `promoteItemToMaster`).

#### 6. Save images

For each user-provided photo:

1. Choose path: `notes/<folder>/<note-slug>/assets/photo-<n>.<ext>` (notes-relative, no leading slash). These folders are **hidden in the notes file sidebar**; only the `.json` note appears.
2. Write bytes with **`notes_write_asset`** (`path`, `contentBase64`).
3. Reference in markdown as `![caption](<folder>/<note-slug>/assets/photo-<n>.<ext>)` — notes-relative only, not `/api/notes-assets/...` in MCP markdown.

#### 7. Write the project note

Use **`notes_write`** (create) or **`notes_read`** + **`notes_write`** (update). Path example: `garden/make-flower-bed` (no `.json`).

Use this structure (omit empty sections). Keep the visible note action-first:

```markdown
# <Project title>

## Checklist

::shared-checklist <masterId> [{"id":"<uuid>","label":"<Name>","masterItemId":"<master-item-id>"}]

::toggle Cost and time
<Rough materials cost in local currency; split “if buying everything” vs “if reusing/salvaging”. Simple table: item, qty, ballpark line cost, then a total range. State what the user already owns that reduces cost.>
<Rough labour time: total active hours for a beginner, calendar span (drying/curing), and a small table by phase (active vs wait). Use ranges, not false precision; say prices vary and suggest phoning suppliers.>
::end-toggle

::toggle Where to buy
<2-4 local merchants from web search; only verified contact details. Omit if no location given.>
::end-toggle

::toggle Before you start
- <Time, weather, drying/curing, access, helper needed>
- <Safety: gloves, eye protection, mask, ventilation, when to call a professional>
- <Key assumptions that affect the job. Keep this short.>
::end-toggle

::toggle Reference images
![<caption>](<folder>/<slug>/assets/photo-1.jpg)
![<caption>](<folder>/<slug>/assets/photo-2.jpg)
::end-toggle

::toggle Planning notes
<Use only when useful: measurements, board sizes, quantities, photo observations, constraints.>
<For fencing/decking: show simple maths (bay length / boards, standard UK sizes). Example: 7 ft bay / 14 boards ≈ 6 in per slot -> often 100 mm picket + 50 mm gap.>
::end-toggle

## Guide

- [ ] <First physical action. Include the target result in the same item.>
- [ ] <Next physical action.>
- [ ] <Next physical action.>
- [ ] <Continue until the project is complete.>

## When you are done
<How to verify success in plain language.>

## If something goes wrong
<Common mistakes and fixes.>
```

**Linked checklist line:** `entriesJson` must be valid JSON array. Each entry needs `id` (new uuid), `label`, and `masterItemId` when linked to the master. Omit `standaloneChecked` when linked.

**Toggle syntax:** Use `::toggle <title>` and `::end-toggle` for sections that should be collapsed in the editor. Toggle body content can include bullet lists, numbered lists, headings, images, and paragraphs.

#### 8. Beginner-writing rules

- Put the checklist before background explanation. The user should see what to buy/own first.
- Use toggles for reference material: photos, shops, assumptions, measurements, and “before you start”.
- Avoid “What you told us”, “What you are doing”, and long explanatory sections unless the user asks for a spec-style note.
- Use a single **Guide** section with checklist items (`- [ ]`). These are work-tracking tasks, not prose bullets.
- Do not add an instruction like “tick off the checklist above”; the Guide itself is the working checklist.
- Do not write `Step 1`, `Step 2`, etc. The checkbox list already gives the sequence.
- **One slow motion per checkbox** — not one whole job phase. If the user has never done the motion, split it into several checkboxes (see **Technique micro-steps** below). Never skip setup, tool choice, or “if stuck”.
- End every Guide item with **Done when** … (one clear sight or feel test).
- Define every tool and material the first time in the **Checklist** or **Before you start** (what it looks like, what you do with it).
- Use generic words where possible (“outdoor area”, “wall”, “fixture”) — garden is one example domain.
- No jargon without a plain definition; no “obviously”, “just”, or “simply”.
- Include safety and “stop and get help” when stakes are high (electricity, gas, structural work, chemicals).

- When salvage is plausible, make the **first Guide item** an audit: sort boards into reuse vs replace before shopping.
- In **Before you start**, add a short **Parts on this job** list for domain nouns (e.g. **picket** = vertical board you see from the street; **rail** = horizontal board pickets nail to; **post** = thick upright in the ground). One line each, no essay.

##### Technique micro-steps (required for unfamiliar work)

Assume the reader has **never** done the task and will not look up a video. A line like “carefully pry off pickets” is **not** enough.

**Quality gate before saving:** For each Guide checkbox, ask: *Could someone with zero experience do this with only what’s written?* If not, split or add a technique toggle.

**Every technique checkbox must include (in plain words, in order):**

| Piece | What to write |
| ----- | ------------- |
| **Stand / side** | Which side of the workpiece you stand on and why (e.g. “work from the garden side so you see nail heads”). |
| **Tool** | Exact tool from the checklist (e.g. “flat end of the **pry bar**”, not “pry”). |
| **Grip / position** | Where the tool touches the work (e.g. “wedge the flat end between picket and rail, just below the nail”). |
| **Motion** | One slow direction (push down / pull toward you / twist — not trade verbs alone). |
| **Stop when** | What changes (wobble, gap, crack sound, nail head raised 5 mm). |
| **If stuck** | One escape (different tool, cut nail, stop and get help). |

**Forbidden without the table above:** pry, lever, bed, score, feather, countersink, tap home, dress, key (paint), flash, chase, plumbed, tamp, screed — or any verb you would only understand after watching someone once.

**Split instead of compress.** Example — **bad** (one checkbox):

```markdown
- [ ] Carefully pry off rotten pickets. Keep rails intact. Done when bad pickets are out.
```

**Good** (several checkboxes; first picket can be slow, then “repeat”):

```markdown
- [ ] Put on **safety gloves** and **glasses**. Spread a tarp under the fence to catch nails and splinters. Done when you are dressed for work and the ground is covered.
- [ ] Stand on the **same side as the pickets** (the “pretty” side). Identify one **rotten picket** — wood is soft, cracked, or breaks when you push it with your hand. Done when you have chosen a single board to remove first.
- [ ] Walk to the **back** of the fence (garden side). On that picket, find the **nail heads** where it meets the **rail** (horizontal board). Count them — usually two per rail, top and bottom. Done when you can point to each nail.
- [ ] **Lift a nail with the claw hammer:** hook the **claw** under a nail head, rest the hammer head on the rail, pull the handle toward you until the nail lifts a few millimetres. If the wood **splits**, stop — use the pry bar step instead. Done when that nail is loose or out.
- [ ] **If the nail will not move:** slide the **flat end** of the **pry bar** into the gap between picket and rail, near the nail. Push the other end of the bar **down** slowly until the picket moves slightly. Move to another spot and repeat — small movements, not one big yank. Done when the picket **wobbles** at that rail.
- [ ] Pull the picket straight out and set it on the tarp. Press your fingernail into the **rail** behind it — **firm** wood can stay; **crumbly** or soft wood means replace that rail later. Done when **one** picket is out and you have checked the rail.
- [ ] Remove the rest of the **rotten or broken pickets** (about 24) the same way — nail lift first, pry bar if stuck. Done when all bad pickets are out and you have checked **every** rail for firm vs rotten.
```

Use the same pattern for other high-friction jobs: digging a post hole, mixing post mix, nailing a picket with even gaps, scraping paint, brushing primer.

**Optional technique toggle** when the same motion repeats many times (20+ pickets): put the full first-time walkthrough in `::toggle How to remove one picket` and keep Guide items short only **after** that toggle exists — never shorten below tool + motion + done.

##### Guide length

- Simple jobs (hang a picture, clear a drain): **8–15** Guide checkboxes.
- Medium DIY (flower bed, repaint a door): **15–25**.
- Multi-phase outdoor (fence, deck, shed base): **25–40** — still one motion per box; use toggles for maths and shopping, not for core technique.

##### Review existing notes

When the user asks to review or “make it simpler”, re-read the Guide and **split any checkbox that names a technique without tool + motion**. Do not only edit the skill — update the note in the same pass unless they asked for skill-only changes.

#### 9. Report back

Tell the user:

- Note path (e.g. `garden/make-flower-bed`)
- Master checklist name and folder scope
- Items **added** vs **reused** on the master
- Link to open in the dashboard: `/notes/<path>`

### Update an in-progress project

Use this whenever the user reports progress, sends mid-project photos, says "review and update my notes", or otherwise changes scope on an existing note. The Guide must reflect the **current** state, not a running log of what changed.

**Core principle:** edit the Guide in place. Do **not** add a "Progress update" toggle as the default; that just buries the real list under a status blurb. Only fall back to a status note when state genuinely cannot be encoded by checking, striking, or rewording items (rare).

#### 1. Read first, classify each Guide item

Read the note with `notes_read`. For every Guide checkbox **and** every supplies/tools entry, decide which bucket it falls into:

| Bucket | Action |
| ------ | ------ |
| **Done** | Set `checked: true`. No strike — checked is the "done" signal. |
| **No longer applicable** (scope shrank, decision changed, user skipped this path) | Set `checked: true` **and** apply `strike: true` to every text run in the item. The strike is the "obsolete" signal so a reader sees what was originally planned. |
| **Still to do, unchanged** | Leave untouched. |
| **Still to do, but reworded** | Edit the text in place. Do not duplicate the item. |
| **New work uncovered by progress** | Insert a new `- [ ]` item at the right point in the sequence. |

Apply the same buckets to the shared checklist entries: items already used get the master `checked: true` via `PATCH promoteItem` (never flip an existing `true` back to `false`); items no longer needed get the entry **removed from this note's `entriesJson`** (do not delete the master item — other projects may still use it).

#### 2. Rewrite supporting toggles to match reality

- **Planning notes / Before you start:** edit numbers and assumptions in place (e.g. "replace 2 posts" → "replace 1 post"). Do not leave a stale figure standing next to a corrected one.
- **Cost and time:** update the table rows and totals to the new scope. If the user already bought something, drop or strike that line.
- **Reference images:** keep the originals. Add new progress photos as `assets/progress-<n>.<ext>` inside the same `Reference images` toggle (chronological order), with captions that say what changed ("Post removed, 2026-06-21"). Do not create a parallel `Progress photos` toggle.

#### 3. When (rarely) to add a status block

Only add a short `::toggle Current state` block when **all** of these are true:

- The change cannot be captured by checking/striking/rewording (e.g. user paused the project for an external reason: waiting on a tradesperson, frozen ground, replacement part on order).
- The reader needs to know *why* before doing the next Guide item.
- One sentence is not enough.

Keep it to a few bullets. Delete the block on the next update when the blocker is gone.

#### 4. Save new photos

For each progress image:

1. `notes/<folder>/<note-slug>/assets/progress-<n>.<ext>` (continue the numbering across updates — do not restart at 1 each time).
2. Write bytes with `notes_write_asset`.
3. Reference inside the existing `Reference images` toggle.

#### 5. Verify and report back

- Re-read the note with `notes_read`.
- Confirm: no Guide item still says "2 posts" if reality is 1; no shared-checklist entry references a removed item id; new images render.
- Report a short diff to the user: items **checked off**, items **struck through**, items **added**, items **reworded**, master checklist changes.

#### Strikethrough syntax (BlockNote)

In note JSON, strike is a text style on each run inside a `checkListItem`:

```json
{ "type": "text", "text": "Brace the leaning panel", "styles": { "bold": true, "strike": true } }
```

Apply `"strike": true` to **every** text run in an obsolete item — partial strike reads as a typo, not a deliberate retraction. Combine with `checked: true` on the item props.

### Complete and archive a project

Use when the user sends finished photos, says the work is complete, or asks to archive.

1. Run the **Update an in-progress project** workflow first so the Guide reflects what actually happened. Then:
2. Save finished photos as `assets/complete-<n>.<ext>` inside `Reference images`.
3. Mark every remaining unfinished **Guide** item `checked: true` (no strike — they were done, not obsolete).
4. Add `## Completed` before `## If something goes wrong`: completion date, 1–3 outcome bullets, finished photos.
5. Archive when the user asks:
   - Preferred: `PATCH /api/notes/<oldPath>` with `{ "newPath": "archive/<folder>/<note-slug>" }`.
   - Fallback: move `notes/<oldPath>.json` to `notes/archive/<folder>/<note-slug>.json`.
   - Image paths can stay pointed at the original asset folder; if you move the asset dir too, rewrite every image path.
6. Report archived path and completion images added.

## Image and checklist reference

| Layer | Format |
| ----- | ------ |
| MCP markdown | `![caption](garden/project/assets/x.jpg)` |
| Saved note JSON | image block `url`: `/api/notes-assets/garden/project/assets/x.jpg` |
| Toggle section | `::toggle Reference images` ... `::end-toggle` |
| Guide item | `- [ ] Do the next physical action` |
| Completed guide item | `- [x] Finished action` |
| Obsolete guide item | `checked: true` + every text run has `styles.strike: true` |
| Progress photo path | `notes/<folder>/<slug>/assets/progress-<n>.<ext>` (numbering continues across updates) |
| Archived project path | `archive/<folder>/<note-slug>` |
| Master file | `collections/<uuid>.json` |
| Note block | `::shared-checklist <masterId> [...]` |

## Verification

- Re-read the note with `notes_read` after `notes_write`.
- Confirm master items exist and linked `masterItemId` values match.
- After skill or code edits in repo: `npm run verify`.

## Sync

After changing this skill file in the repo, run **Skills → Sync skills** in the dashboard (or `sync_skills` script).
