# Mobile Audit & Fixes — 2026-06-15

Live walk of every screen in Chrome at phone widths (500px, then 375px /
iPhone SE) plus a full static scan. Goal: find and fix anything that isn't
mobile-friendly, including overlay buttons and awkward horizontal scrolling.

## Method note (why the first pass under-reported)

The first pass measured page-level overflow (`documentElement.scrollWidth`).
That misses the real problem: the app's `<main>` is `overflow-y: auto`, which
makes `overflow-x` compute to `auto` too — so overflow scrolls **inside `main`**
without widening the document. The page looks fine; the content area scrolls
sideways. The correct probe is `main.scrollWidth - main.clientWidth`, plus a
`main.scrollLeft` write-back to confirm it's actually scrollable. Every fix
below was verified to `mainOver: 0` and non-scrollable at 375px.

## Bugs found & fixed

1. **Home — PR review rows scrolled sideways ~150px.**
   The `repo#number` id (`components/TodayFocusView.tsx`) was `shrink-0` and
   ~305px wide, so it shoved the row past the viewport and the title collapsed
   to 0. Fix: `min-w-0 shrink truncate` — the id truncates on phones and still
   shows in full when desktop has room.

2. **Repos — ~312px sideways scroll below the fold.**
   `app/repos/client.tsx` had two grids whose columns were only defined at a
   responsive breakpoint (`md:grid-cols-4`, `xl:grid-cols-[…420px]`) with no
   base. Below the breakpoint a CSS grid with no column template sizes columns
   to **content**, and a long `/Users/…/…` path blew the column to 665px. Fix:
   add a constrained `grid-cols-1` base to both.

3. **Notes/Docs editor — same grid bug.**
   `components/BlockNoteEditor.tsx` had two `md:grid-cols-[minmax(220px,1fr)_auto]`
   grids with no base. Fix: `grid-cols-1` base on both.

4. **Status — busy header overflowed.**
   The header action cluster (LAN-IP badge + QR + Commit & sync + Sync +
   refresh) couldn't fit or wrap at 375px. Fix: give `.page-header` `flex-wrap`
   on phones in `globals.css` (mirrors the existing `.card-header` treatment),
   so the cluster drops to its own line. Also hardened the services row
   (`min-w-0` + truncate on the name, `shrink-0` on the controls).

5. **Global — hidden tooltips created phantom horizontal scroll.** *(root cause)*
   `[data-tooltip]::after` is `position:absolute; left: calc(100% + 8px);
   white-space:nowrap`. Even at `opacity:0` it stayed in layout, so any tooltip
   near the right edge of a non-clipping container (worst on Status) projected
   its hidden label off-screen and inflated `main`'s scroll width — a real,
   scrollable ~93px sideways drift. Fix: `display:none` when hidden (out of
   layout entirely), restored to `display:block` on hover, with
   `transition-behavior: allow-discrete` + `@starting-style` preserving the
   fade/scale in and out. This removes the whole class of bug app-wide, not
   just on Status.

## Verified clean (live @ 375px, `mainOver: 0`, not scrollable)

Today, Work, Review, Calendar, PRs, Tickets, Repos, Actions, Activity→Tasks,
Bookmarks, Collections→Notes, Datadog, Diagrams, Docs, Learnings, Notes,
Opencode, Ops, Chamber, Search, Setup, Shared, Skills, Status, Claude.

## Not an issue

- The floating "N" bottom-left is the **Next.js dev-tools indicator** (dev-only).
- tldraw (`/diagrams/[…]`) and BlockNote editors are third-party; heavy on first
  compile but not layout defects.

## Verification

`eslint` and `tsc --noEmit` both pass clean on all changed files
(`TodayFocusView.tsx`, `repos/client.tsx`, `BlockNoteEditor.tsx`,
`status/client.tsx`, `globals.css`).

## Desktop regression check (done @ 2560px)

Walked the edited screens at full width — no regressions:

- **Tooltips** — hover-tested live; the label still fades in correctly
  (`display:none` → `block` via `@starting-style`). The global change is safe.
- **Home** — repo ids render in **full** when there's room (truncate only
  engages when space is tight).
- **Repos** — the `xl:` two-column layout (repos list + GitHub panel) is intact;
  the `grid-cols-1` base only applies below `md`.
- **Status** — `.page-header` is `nowrap` on desktop (wrap is `max-width:767px`
  only); single-row header, 3-col services grid, all normal.

## Optional (not done — flagging only)

- The Status LAN-IP/QR badge ("copy this page's URL to open on your phone") is
  arguably redundant *on* a phone; could be `sm:`-hidden to declutter the mobile
  header further. Product call, not a bug — left as-is.
