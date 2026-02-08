# MCP Servers

Gemini Scribe supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for connecting to external tool servers. This allows the AI agent to use tools provided by local MCP servers alongside the built-in vault tools.

::: warning Desktop Only
MCP server support requires spawning local processes and is only available on desktop (Windows, macOS, Linux). The MCP settings section is hidden on mobile.
:::

## What is MCP?

MCP (Model Context Protocol) is an open standard that lets AI applications connect to external tool providers. An MCP server is a local process that exposes tools the AI can call — for example, a filesystem server that provides file operations, a database server that provides query tools, or a custom server you build yourself.

When you connect an MCP server to Gemini Scribe, its tools appear alongside the built-in vault tools. The agent can discover and call them during conversations, with the same confirmation flow and safety features as built-in tools.

## Setup

### Prerequisites

- Obsidian running on desktop (not mobile)
- An MCP server to connect to (see [Finding Servers](#finding-servers) below)
- The server's command and arguments

### Adding a Server

1. Open **Settings > Gemini Scribe**
2. Click **Show Advanced Settings**
3. Scroll to the **MCP Servers** section
4. Toggle **Enable MCP servers** on
5. Click **Add Server**

In the server configuration modal:

- **Server name**: A unique, friendly name (e.g., "filesystem", "GitHub")
- **Command**: The executable to run (e.g., `npx`, `python`, `/usr/local/bin/my-server`)
- **Arguments**: One argument per line
- **Environment variables**: Optional `KEY=VALUE` pairs, one per line
- **Enabled**: Whether to connect automatically on plugin load

### Testing the Connection

Click **Test Connection** to temporarily connect to the server and discover its tools. If successful, you'll see the list of available tools and can configure trust settings.

### Tool Trust

Each tool from an MCP server can be marked as **trusted** or **untrusted**:

- **Trusted tools** execute without a confirmation dialog (like built-in read-only tools)
- **Untrusted tools** require you to approve each execution in the chat (the default)

New tools that appear when a server is updated default to untrusted. You can change trust settings at any time by editing the server configuration.

## Example: Filesystem Server

The MCP project provides a reference filesystem server. To set it up:

**Server name**: `filesystem`

**Command**: `npx`

**Arguments** (one per line):

```text
-y
@modelcontextprotocol/server-filesystem
/path/to/allowed/directory
```

This gives the agent tools to read, write, and list files in the specified directory — separate from your Obsidian vault.

## Finding Servers

Popular MCP servers include:

- **[@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)** — File operations
- **[@modelcontextprotocol/server-github](https://www.npmjs.com/package/@modelcontextprotocol/server-github)** — GitHub API integration
- **[@modelcontextprotocol/server-brave-search](https://www.npmjs.com/package/@modelcontextprotocol/server-brave-search)** — Web search via Brave

Browse the [MCP Server Registry](https://github.com/modelcontextprotocol/servers) for a full list of community servers.

## How It Works

When an MCP server is connected:

1. Gemini Scribe spawns the server process using the configured command
2. It queries the server for its list of tools via the MCP protocol
3. Each tool is registered in the plugin's tool system with a namespaced name (`mcp__<server>__<tool>`)
4. The agent can discover and call these tools during conversations
5. Tool calls go through the same confirmation and loop detection as built-in tools
6. When the plugin unloads, all server processes are shut down

## Troubleshooting

### Server fails to connect

- Verify the command exists and is in your PATH
- Check that all required arguments are correct
- Look for error messages in the server status indicator (red dot)
- Enable **Debug Mode** in settings and check the developer console

### Tools not appearing

- Ensure the server is connected (green status dot)
- Verify **Enable MCP servers** is toggled on
- Check that the server's tools are compatible (MCP v1 tools)

### Server crashes during use

- The server status will change to disconnected
- Edit the server configuration and try reconnecting
- Check the server's own logs for error details

## Limitations

- **Stdio transport only**: v1 supports local process spawning via stdio. HTTP/SSE transport may be added in a future version.
- **Tools only**: MCP resources and prompts are not yet supported.
- **Desktop only**: Not available on mobile due to process spawning requirements.
