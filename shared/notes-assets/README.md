# Notes assets

Implementation lives in this folder (`markdown.ts` for client-safe helpers, `server.ts` for Node fs I/O). Dashboard re-exports via `dashboard/lib/notes-assets/`.

- **On disk:** `NOTES_DIR/<notes-relative-path>` (e.g. `garden/bed/assets/photo-1.jpg`)
- **MCP markdown:** `![caption](garden/bed/assets/photo-1.jpg)`
- **BlockNote JSON:** `url` = `/api/notes-assets/garden/bed/assets/photo-1.jpg`
- **HTTP:** `GET /api/notes-assets/<notes-relative-path>`

Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`.
