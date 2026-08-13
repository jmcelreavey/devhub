---
title: Memory architecture
description: Why DevHub stores memory as git-backed local files, and what the alternatives cost.
order: 9
icon: Database
tags: [architecture, notes]
related:
  - architecture/notes-system
  - architecture/token-budget
  - architecture/recall
---

# Memory Options

DevHub uses git-backed local files for memory.

This is intentional. The goal is durable, inspectable, portable context without adding an external database or opaque memory store.

## Chosen Approach

| Choice              | Why                                                   |
| ------------------- | ----------------------------------------------------- |
| Local files         | Easy to read, edit, back up, and diff                 |
| Git sync            | Works across machines with normal developer workflows |
| BlockNote JSON      | Supports rich text in the dashboard                   |
| Markdown conversion | Keeps notes accessible to AI tools through MCP        |
| Learnings layer     | Keeps reusable memory small and focused               |

## Alternatives Considered

| Option               | Tradeoff                                                    |
| -------------------- | ----------------------------------------------------------- |
| SQLite               | Good for querying, but less transparent for manual review   |
| Hosted database      | More powerful, but adds deployment and auth concerns        |
| Vector database      | Useful for fuzzy recall, but less exact and harder to audit |
| Tool-specific memory | Convenient, but fragmented across tools and machines        |

## Why This Works Well For DevHub

DevHub is personal and local-first. A file-based memory system matches that shape:

- No server dependency.
- No external account required.
- No hidden sync process.
- Easy recovery from Git history.
- Exact retrieval when a note path is known.

## Limitations

- Git conflicts are possible if the same note is edited on multiple machines.
- Very large notes can become hard to review.
- Search is simpler than a dedicated database search engine.

For this project, those tradeoffs are acceptable because clarity and ownership matter more than scale.

## Retrieval sits on top, not instead

The table above rejects vector search as "less exact and harder to audit". That
holds for a store which *replaces* the files. [Recall](recall.md) adds a
derived index beside them instead: files stay canonical, every retrieved
passage cites the `sourceId` it came from, and the whole index is gitignored
and safe to delete because it rebuilds from the files in about 150 ms.

Recall also introduces the one genuinely new source of truth in this design —
an append-only event log under `notes/.index/events/`. It is NDJSON precisely
so it keeps the properties this page argues for: readable with `tail`,
diffable, recoverable from git history.
