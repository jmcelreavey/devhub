# Figma

The Figma MCP integration gives AI agents access to design files, components, frames, screenshots, and design system context directly from Figma.

## What It Enables

- Read design context and metadata from Figma files
- Generate screenshots of frames, components, and pages
- Search design system assets (components, variables, styles)
- Create and edit designs via the Figma Plugin API
- Import web pages into Figma as design references

## Setup

### Prerequisites

- A Figma account with access to the team's design files
- OpenCode installed and configured (see [OpenCode and OpenChamber](../guides/opencode-and-chamber.md))

### OAuth Client Registration

Figma's MCP server uses OAuth Dynamic Client Registration with a **client name whitelist**. OpenCode is not yet whitelisted directly, so you need to register an OAuth client with an approved name.

**One-time registration via curl:**

1. Generate a Personal Access Token at **Figma → Settings → Security → Personal access tokens**

2. Register an OAuth client:

```bash
export FIGMA_PAT="figd_your_token_here"

curl -s -X POST https://api.figma.com/v1/oauth/mcp/register \
  -H "Content-Type: application/json" \
  -H "X-Figma-Token: $FIGMA_PAT" \
  -d '{
    "client_name": "Claude Code (figma)",
    "redirect_uris": ["http://127.0.0.1:19876/mcp/oauth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

3. Save the returned `client_id` and `client_secret`. The PAT is no longer needed after this step.

### OpenCode Configuration

Add the Figma MCP server to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "figma": {
      "type": "remote",
      "url": "https://mcp.figma.com/mcp",
      "enabled": true,
      "oauth": {
        "clientId": "<your_client_id>",
        "clientSecret": "<your_client_secret>",
        "scope": "mcp:connect"
      }
    }
  }
}
```

### Authentication

```bash
# Clear stale auth if you've retried
rm -f ~/.local/share/opencode/mcp-auth.json

# Opens browser for OAuth consent
opencode mcp auth figma
```

After OAuth completes, tokens are refreshed automatically.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `HTTP 403: Forbidden` during `mcp auth figma` | OAuth client not registered with an approved client name — follow the registration steps above |
| `HTTP 401` or token errors after config | Clear stale auth: `rm -f ~/.local/share/opencode/mcp-auth.json` and re-run `opencode mcp auth figma` |
| PAT does not work as a Bearer token | Expected — Figma MCP only accepts OAuth tokens with `mcp:connect` scope, not PATs |
| Tools return permission errors | Check that the OAuth consent screen granted the `mcp:connect` scope |

## DevHub MCP Definition

The shared MCP config is at `mcp/shared/figma.json`. This file defines the server URL and description but does not include OAuth credentials — those live only in the local `~/.config/opencode/opencode.json` file.

## Related

- [Learning note: Figma MCP + OpenCode Setup](../../notes/learnings/figma-mcp-opencode-setup.json) — detailed debugging backstory and gotchas
- OpenCode GitHub issues: #5636, #3875, #988
