# MCP Server

DevHub includes a local MCP server so AI tools can work with notes, docs, tasks, and diagrams.

MCP stands for Model Context Protocol. It is a way for AI tools to call local capabilities through a standard interface.

## What The Server Provides

| Tool Group | Capabilities                                            |
| ---------- | ------------------------------------------------------- |
| Notes      | List, read, write, append, search, and delete notes     |
| Docs       | List, read, write, append, search, and delete docs      |
| Tasks      | List, create, update, delete, and view task history     |
| Diagrams   | List, read, create, update, delete, and rename diagrams |

## Storage Model

The MCP server uses local files, not a database.

| Data     | Format                     |
| -------- | -------------------------- |
| Notes    | BlockNote JSON             |
| Docs     | Markdown (`.md`)           |
| Tasks    | JSON files grouped by date |
| Diagrams | tldraw JSON            |

The server also converts notes between Markdown-like text and BlockNote JSON so AI tools can read and write notes naturally. Docs are read and written as raw Markdown. Core vault filesystem logic lives in [`shared/vault/`](../../shared/vault/README.md) and is shared by the dashboard and MCP server.

The MCP server runs as plain Node (stdio). It imports `shared/vault` with **relative paths**, not dashboard `@/` aliases — those aliases are not resolved when tools spawn the server. See the vault README for the import rules dashboard contributors use as well.

## How AI Tools Use It

AI tools launch the MCP server as a local stdio process. The shared MCP config tells each tool how to start it and where the notes, docs, and task directories live.

Users normally do not need to start the MCP server manually. The AI tool starts it when needed.

## Common Uses

- Read today's note.
- Read or search repo docs (architecture, guides, reference).
- Append meeting notes.
- Create or complete a task.
- Search recent daily notes.
- Store a reusable learning.
- Create a tldraw diagram shell.

## Safety Model

The server is scoped to configured local directories. It should not be treated as a general filesystem API.

Keep secrets out of notes unless you intentionally store them there.
