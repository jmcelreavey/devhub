---
title: Sharing notes, docs, and diagrams
description: Publish a note, doc, or diagram as a secret Gist, or as a one-time link that self-destructs.
order: 8
icon: Share2
tags: [workflow]
related:
  - architecture/notes-system
  - integrations/github
---

# Sharing Notes, Docs, and Diagrams

DevHub has two ways to hand someone a note, doc, or diagram without committing it to git. They behave
differently on purpose:

| | **Share** (live link) | **One-time** |
| --- | --- | --- |
| Backed by | Secret GitHub Gist | PrivateBin paste |
| URL | Stable — re-push edits to it | New link every time |
| Lifetime | 14 days, or until you remove it | Destroyed on first read |
| Password | No | Yes, generated for you |
| Needs | `gh` authenticated | Nothing |
| Good for | An evolving doc someone keeps checking | A one-off handover you'd rather not leave lying around |

Pick **Share** when the recipient should keep seeing your latest version. Pick
**One-time** when they should see it once and then it should be gone.

## Live Links (Gist)

### Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`).
- GitHub enabled in **Setup** (same gate as PR views and the **Live links** sidebar entry).

Publishing uses `gh gist create` / `gh gist edit` under the hood. DevHub does not store a separate GitHub token.

### Publish From The Editor

Open any note or doc. The **Share** control in the editor header:

1. Converts the current content to markdown (BlockNote notes → **portable GitHub markdown** via `blocksToPortableMarkdown` — toggles become `<details>`, DevHub `::directives` are humanized or dropped, bold/italic/code survive; docs use the on-disk `.md` file; diagrams become a markdown wrapper around a **tldraw JSON snapshot**).
2. Creates a **secret** gist (unlisted, but readable by anyone with the URL).
3. Copies the gist URL to your clipboard.

If the note is already live, clicking **Share** again (or **Update** on the **Live links** page) overwrites the gist with the current content.

Empty notes cannot be published.

### Diagrams

Open a diagram in the editor. **Share** / **One-time** sit next to Copy location — same live / stale / Update / unshare UX as notes. The gist is markdown containing the tldraw JSON (not a rendered PNG/SVG). MCP: `share_publish` / `share_one_time` with `vault: "notes"` and `path: "diagrams/..."`.

### Live Links Registry

**Live links** (`/shared`) lists every gist DevHub is tracking:

| Column / state | Meaning |
| -------------- | ------- |
| Stale badge    | Source file changed since the last gist push (or the file was deleted) |
| Expiry label   | Auto-cleanup countdown (see below) |
| Update         | Re-push current content to the gist |
| Remove         | Delete the gist and drop the registry entry |

The registry is local state at `~/.local/state/devhub/shares.json` (schema version 2: `shares[]` for live gists, `oneTime[]` for unread PrivateBin links). It is **not** synced through git. Gists themselves live on GitHub under your account; one-time pastes live on the configured PrivateBin instance as ciphertext DevHub cannot read back.

### Expiry And Cleanup

Live links expire **14 days** after they are first published. A background sweep (every six hours while the dashboard is running) deletes expired gists and removes their registry entries.

Use **Remove** or **Remove all** on `/shared` to unpublish early.

---

## One-Time Links (PrivateBin)

The **One-time** button in the editor header publishes the note as a
[PrivateBin](https://privatebin.info/) paste that the server destroys the first time it is
opened. No `gh`, no account, no token — PrivateBin is free and needs no sign-up.

The note is encrypted **on this machine** before it is sent. The key lives in the URL
fragment (after the `#`), which browsers never transmit, so the instance stores ciphertext
it cannot read.

### Publishing

1. Pick an expiry — 1 hour, 1 day or 1 week. This is a backstop; the paste normally dies on
   first read.
2. Leave **Protect with a generated password** on unless you have a reason not to.
3. **Create link**.

You get back a link and a six-word password, with a copy button for each.

> **Send them separately.** The password is a second factor. Pasting both into the same
> Slack message makes it decoration. The password is shown **once** and never stored — if
> you lose it, revoke the link and make a new one.

### Why Slack Doesn't Burn The Link

A naive burn-after-reading link pasted into Slack gets fetched by Slack's link unfurler
before any human opens it, which destroys the paste and hands your recipient a 404.
Outlook and corporate link scanners do the same.

DevHub emits the `#-` URL form (note the dash after the `#`), which PrivateBin added for
exactly this. It makes the page ask for confirmation instead of decrypting on load, so a
scanner that runs the JavaScript still doesn't consume the paste.

### Managing One-Time Links

`/shared` lists unread one-time links below the live links, with **Copy** and **Revoke**. The **Live links** Library tab and ⌘K palette entry are gated on GitHub setup (`gh` authenticated), but one-time links created from the editor work without `gh` — navigate to `/shared` directly or use MCP `share_list` / `share_revoke_one_time` to manage them when the tab is hidden.

There is deliberately no *Update* button and no *Open* link: the paste is immutable, and
opening it from DevHub would spend the recipient's only read.

DevHub **cannot tell you whether a link has been read** — the server destroys it and
reports to nobody. A link disappearing from the list means it expired locally, not that it
was opened. **Revoke** only works while the link is still unread; afterwards it just tidies
the local list.

### Configuration

| Setting | Default |
| ------- | ------- |
| `PRIVATEBIN_URL` in `dashboard/.env.local` | `https://privatebin.net` |

Point it at a self-hosted instance if you'd rather not depend on the public one's uptime.
Because content is encrypted client-side, this is a choice about *availability*, not
confidentiality.

---

## Security Model

| Property | Live link (gist) | One-time link |
| -------- | ---------------- | ------------- |
| Visibility | Unlisted, but **anyone with the link can read** | Ciphertext only; needs the key in the URL, plus the password if set |
| Server can read it | Yes — GitHub holds plaintext | No — encrypted before it leaves your machine |
| Write access | Read-only; only you can update or delete | Read-once; nobody can update |
| Repo sync | Shared content does not appear in `notes/`, `docs/` or git unless you commit it separately | Same |

Treat live links like unlisted URLs: fine for short-lived handoffs, not for long-term or
sensitive archives. One-time links are the stronger option, but they are still a link —
anyone holding it before it's read can open it.

## Troubleshooting

| Problem | Check |
| ------- | ----- |
| Share button fails | `gh auth status`; GitHub enabled in Setup |
| Live links nav missing | Enable GitHub in **Setup** |
| Stale badge won't clear | Open the note, edit if needed, then **Update** on `/shared` or re-share from the editor |
| Link stopped working | 14-day TTL may have expired; re-publish if you still need it |
| Wrong formatting in gist | Notes export portable markdown (not DevHub round-trip `::directives`); shared checklists, task refs, and other rich blocks may simplify or drop |
| "Please wait 10 seconds between each post" | privatebin.net rate-limits creation to one paste per 10 seconds per IP. Wait and retry; a self-hosted instance sets its own limit |
| One-time link fails to create | The instance may be down — check `PRIVATEBIN_URL`, or point it at another instance |
| Recipient says the one-time link is dead | Something opened it first (a link scanner, or a forwarded copy), or the expiry elapsed. Re-share |
| Recipient can't decrypt | They need the password too, and the full URL including everything after the `#` — some clients truncate it |

## MCP Tools

Agents can share through the dashboard-backed MCP tools (dashboard must be running):

| Tool | Use when |
| ---- | -------- |
| `share_list` | Inspect live and unread one-time links |
| `share_publish` | Stable secret gist (`vault` + `path`) |
| `share_one_time` | Burn-after-reading link; passphrase returned once in the tool result |
| `share_revoke` | `id` for one-time, or `vault`+`path` for a live gist |

`share_one_time` puts the link and password in the same response — deliver them on separate channels. Full inventory and workflows: [MCP Server](../architecture/mcp-server.md#share-a-note-or-doc-from-an-agent).

## Related Docs

- [GitHub integration](../integrations/github.md) — `gh` auth and PR views
- [Notes System](../architecture/notes-system.md) — vault storage and sidebar ordering
- [API Routes](../reference/api-routes.md) — `/api/share` endpoints
- [MCP Server](../architecture/mcp-server.md) — `share_*` and workspace read tools
