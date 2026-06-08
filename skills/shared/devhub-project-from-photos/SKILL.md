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

If the user is creating a new project note, follow **Create/update a project note**. If they send completion photos or say the project is done, follow **Complete and archive a project**.

### Create/update a project note

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

### Complete and archive a project

Use this when the user sends finished photos, says the work is complete, or asks to archive a project.

1. Identify the existing project note path (for example `garden/fence-repair-repaint`).
2. Save finished photos under the project asset folder:
   - `notes/<folder>/<note-slug>/assets/complete-<n>.<ext>`
   - Reference them as `![caption](<folder>/<note-slug>/assets/complete-<n>.<ext>)`.
3. Read the current note and update it:
   - Mark every unfinished **Guide** checklist item checked **only if** the user says the project is complete.
   - Add `## Completed` near the end, before `## If something goes wrong` when that section exists.
   - Include completion date, 1-3 plain-language outcome bullets, and the finished photos.
4. Archive the note when the user asks for archive or the project is clearly complete:
   - Preferred dashboard/API path: `PATCH /api/notes/<oldPath>` with `{ "newPath": "archive/<folder>/<note-slug>" }`.
   - Fallback filesystem path: move `notes/<oldPath>.json` to `notes/archive/<folder>/<note-slug>.json`.
   - Asset paths in note markdown may remain pointed at the original asset folder so image links keep working. If you also move the asset directory, rewrite every image path in the note to the new archive location.
5. Report the new archived path and the completion images added.

## Image and checklist reference

| Layer | Format |
| ----- | ------ |
| MCP markdown | `![caption](garden/project/assets/x.jpg)` |
| Saved note JSON | image block `url`: `/api/notes-assets/garden/project/assets/x.jpg` |
| Toggle section | `::toggle Reference images` ... `::end-toggle` |
| Guide item | `- [ ] Do the next physical action` |
| Completed guide item | `- [x] Finished action` |
| Archived project path | `archive/<folder>/<note-slug>` |
| Master file | `collections/<uuid>.json` |
| Note block | `::shared-checklist <masterId> [...]` |

## Verification

- Re-read the note with `notes_read` after `notes_write`.
- Confirm master items exist and linked `masterItemId` values match.
- After skill or code edits in repo: `npm run verify`.

## Sync

After changing this skill file in the repo, run **Skills → Sync skills** in the dashboard (or `sync_skills` script).
