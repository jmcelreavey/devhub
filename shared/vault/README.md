# Shared vault layer

Single source of truth for file-backed **notes** (`.json`) and **docs** (`.md`) vaults.

Used by:

- **Dashboard** — [`dashboard/lib/vault/`](../../dashboard/lib/vault/) extends this layer with note assets, BlockNote search, and browser-only path helpers.
- **MCP server** — [`mcp-servers/devhub-server/src/shared.ts`](../../mcp-servers/devhub-server/src/shared.ts) wraps `VaultStorage` for workspace-scoped docs, while [`mcp-servers/devhub-server/src/storage.ts`](../../mcp-servers/devhub-server/src/storage.ts) layers note search and assets on top.

## Dashboard imports

The Next.js app lives in `dashboard/`. **Dev uses webpack** (`run-next-with-env.ts` passes `--webpack`) so `../shared/` imports resolve without setting `turbopack.root` to the repo root — that setting makes Turbopack watch `notes/`, `docs/`, etc. and can exhaust RAM.

Use relative imports from dashboard code:

```typescript
import { VAULT_PATHS } from "../../shared/vault/vault-routes.ts";
```

Do not use a bare `@shared` alias — Node instrumentation hooks do not resolve it at runtime.

**Client components** must only import client-safe modules (`vault-routes.ts`, `relative-path.ts`, `vault-path.ts`, `vault-codec.ts`) — never `vault-storage.ts` or `index.ts` (those pull in `node:fs`).

MCP and other Node scripts outside Next should keep relative imports (`../../../shared/vault/…`).

## Quick start

```typescript
import {
  VaultStorage,
  jsonVaultCodec,
  markdownVaultCodec,
  flattenTree,
  VAULT_PATHS,
} from "../../shared/vault/index.ts";

const notes = new VaultStorage("/path/to/notes", jsonVaultCodec);
const docs = new VaultStorage("/path/to/docs", markdownVaultCodec);

docs.write("architecture/overview", "# Overview\n");
const page = VAULT_PATHS.docs.pageHref("architecture/overview"); // "/docs/architecture/overview"
flattenTree(docs.list()); // MCP-friendly tree lines
```

## Modules

| Module | Purpose |
|--------|---------|
| `vault-storage.ts` | List/read/write/delete/rename + text search |
| `vault-codec.ts` | JSON (BlockNote) and Markdown codecs |
| `vault-path.ts` | Slug ↔ URL helpers (no `window` / `fetch`) |
| `relative-path.ts` | Resolve relative links in editor content |
| `tree.ts` | Flatten vault trees for MCP list output |
| `content-dirs.ts` | `NOTES_DIR` / `DOCS_DIR` env resolution |

When adding a third vault type, extend `VaultCodec` and register paths in `content-dirs.ts` / dashboard `vault-public.ts` — do not copy storage logic again.
