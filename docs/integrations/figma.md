---
title: Figma
description: Give AI agents access to design files, components, frames and design-system context.
order: 5
icon: PenTool
tags: [integrations]
related:
  - architecture/mcp-server
---

# Figma

The shared Figma MCP entry connects agent tools to Figma's remote server at
`https://mcp.figma.com/mcp`. It is disabled by default.

## What It Enables

Agents can read design context, inspect frames and components, and request
screenshots. The remote server also offers canvas-writing workflows; availability
depends on the client and your file permissions. See Figma's
[tools and setup guide](https://developers.figma.com/docs/figma-mcp-server/).

## Setup

### Prerequisites

- A Figma account with access to the files you want to use.
- A client listed in [Figma's MCP catalogue](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server).

### OAuth Client Registration

Use your client's normal OAuth flow. Follow
[Figma's client-specific setup instructions](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
rather than registering a client under another product's name.

### OpenCode Configuration

OpenCode supports remote MCP servers with OAuth. Its
[OAuth documentation](https://docs.opencode.ai/docs/mcp-servers/#oauth) describes this
configuration:

```json
{
  "mcp": {
    "figma": {
      "type": "remote",
      "url": "https://mcp.figma.com/mcp",
      "enabled": true
    }
  }
}
```

Figma must also accept the client. If it rejects OpenCode, use a client from
Figma's supported list.

### Authentication

For an accepted OpenCode client:

```bash
opencode mcp auth figma
```

Other clients use the authentication control in their MCP settings.

## Troubleshooting

| Problem | Check |
| --- | --- |
| OAuth registration is rejected | The client is listed in Figma's current MCP catalogue |
| Tokens have expired | Re-authenticate through the client's MCP controls |
| Tools return permission errors | Your Figma account has access to the requested file |

## DevHub MCP Definition

`mcp/shared/figma.json` holds the URL and description. Enable the entry and sync
MCP configs to the tools you use. OAuth credentials stay in each client's local
authentication store.

## Related

- [Skills — MCP tab](../guides/skills.md#mcp-tab) — catalogue and sync controls
- [Terminal and agent CLI](../guides/terminal-and-agent-cli.md) — agent tools
