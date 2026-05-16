# MCP Servers

Gemini Scribe has experimental support for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for connecting to external tool servers. This allows the AI agent to use tools provided by MCP servers alongside the built-in vault tools.

## Transport Types

Gemini Scribe supports two transport types for connecting to MCP servers:

| Transport | Description                                                        | Platform      |
| --------- | ------------------------------------------------------------------ | ------------- |
| **Stdio** | Spawns a local process and communicates via stdin/stdout           | Desktop only  |
| **HTTP**  | Connects to a remote server via HTTP with Server-Sent Events (SSE) | All platforms |

::: tip
HTTP transport works on mobile devices (iOS and Android), making it possible to use MCP servers from anywhere. Stdio transport requires the ability to spawn processes and is limited to desktop (Windows, macOS, Linux).
:::

## What is MCP?

MCP (Model Context Protocol) is an open standard that lets AI applications connect to external tool providers. An MCP server provides tools the AI can call — for example, a filesystem server that provides file operations, a database server that provides query tools, or a custom server you build yourself.

When you connect an MCP server to Gemini Scribe, its tools appear alongside the built-in vault tools. The agent can discover and call them during conversations, with the same confirmation flow and safety features as built-in tools.

## Setup

### Prerequisites

- A Google AI API key configured in the plugin
- An MCP server to connect to (see [Finding Servers](#finding-servers) below)
- For **stdio** servers: Desktop platform (Windows, macOS, Linux) with the server installed locally
- For **HTTP** servers: A running MCP server accessible via URL

### Adding a Server

1. Open Obsidian Settings
2. Navigate to **Gemini Scribe** settings
3. Scroll to the **MCP Servers** section
4. Toggle **Enable MCP servers** on
5. Click **Add Server**
6. Select the **Transport** type:
   - **Stdio (local process)**: Enter the command, arguments, and optional environment variables
   - **HTTP (remote server)**: Enter the server URL
7. Click **Test Connection** to verify and discover available tools
8. Configure tool trust settings (see below)
9. Click **Save**

### Tool Trust

Each tool from an MCP server can be marked as **trusted** or **untrusted**:

- **Trusted tools** execute without confirmation — useful for read-only operations you use frequently
- **Untrusted tools** require approval before each execution — recommended for tools that modify data

You can configure trust per tool when adding/editing a server, after clicking **Test Connection** to discover available tools.

## Examples

### Stdio: Filesystem Server

The MCP project provides a reference filesystem server. To set it up:

1. Install Node.js
2. Add a new MCP server with:
   - **Transport**: Stdio (local process)
   - **Name**: `filesystem`
   - **Command**: `npx`
   - **Arguments**:
     ```text
     -y
     @modelcontextprotocol/server-filesystem
     /path/to/your/folder
     ```
3. Test the connection and save

### HTTP: Remote MCP Server

To connect to an MCP server running on your network or the cloud:

1. Ensure the server is running and accessible
2. Add a new MCP server with:
   - **Transport**: HTTP (remote server)
   - **Name**: `my-remote-server`
   - **URL**: `http://localhost:3000/mcp` (or your server's URL)
3. Test the connection and save

::: tip
HTTP servers can run anywhere — on your local machine, on another computer on your network, or in the cloud. This is especially useful for mobile access.
:::

### HTTP: Server with OAuth

Some MCP servers require OAuth authentication. Gemini Scribe handles the full OAuth flow automatically:

1. Add a new MCP server with:
   - **Transport**: HTTP (remote server)
   - **Name**: `my-oauth-server`
   - **URL**: `https://example.com/mcp`
2. Click **Test Connection**
3. If the server requires OAuth, your browser will open to the authorization page
4. Sign in and authorize the application
5. You'll be redirected back to Obsidian automatically
6. Tokens are stored securely in Obsidian's SecretStorage (OS keychain)

::: tip
OAuth tokens persist across Obsidian restarts. To clear stored credentials, click **Clear OAuth Credentials** in the server's edit dialog.
:::

::: warning
The OAuth callback runs a temporary local server on port 8095. Ensure this port is available. The authorization flow times out after 2 minutes.
:::

### Environment Variables

Stdio servers can be configured with environment variables. These are useful for passing API keys, paths, or other configuration to the server process.

When adding or editing a stdio server, enter `KEY=VALUE` pairs (one per line) in the **Environment variables** field:

| Variable        | Example Use Case                               |
| --------------- | ---------------------------------------------- |
| `BRAVE_API_KEY` | API key for Brave Search MCP server            |
| `GITHUB_TOKEN`  | Personal access token for GitHub MCP server    |
| `HOME`          | Override home directory for the server process |

::: tip
Environment variable values often hold sensitive credentials. Gemini Scribe stores them in Obsidian's **SecretStorage** (your operating system's keychain), not in the plugin's `data.json`. Because the keychain is per-device, these values do **not** sync across machines — if you use the same vault on multiple devices, re-enter the environment variables on each one.
:::

## Finding Servers

Popular MCP servers include:

- **[@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)** — File operations
- **[@modelcontextprotocol/server-brave-search](https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search)** — Web search via Brave
- **[@modelcontextprotocol/server-github](https://github.com/modelcontextprotocol/servers/tree/main/src/github)** — GitHub repository operations

Browse the [MCP Server Registry](https://github.com/modelcontextprotocol/servers) for a full list of community servers.

## How It Works

When an MCP server is connected:

1. **Stdio**: The plugin spawns the server process with the configured command and arguments. **HTTP**: The plugin connects to the server URL via HTTP.
2. It queries the server for its list of tools via the MCP protocol
3. Each tool is registered in the plugin's tool system with a namespaced name (`mcp__<server>__<tool>`)
4. When the agent calls a tool, the plugin forwards the request to the MCP server and returns the result
5. The confirmation flow works the same as built-in tools — untrusted tools require approval

## Troubleshooting

**Server won't connect (stdio)**

- Verify the command is installed and accessible from Obsidian's environment
- Check that the arguments are correct
- Ensure you're on a desktop platform (stdio requires process spawning)
- Try running the command manually in a terminal to verify it works
- Enable Debug Mode in settings for detailed MCP logs

**Server won't connect (HTTP)**

- Verify the server is running and the URL is correct
- Check that there are no firewall or network issues blocking the connection
- Ensure the URL includes the correct path (e.g., `/mcp`)
- Enable Debug Mode in settings for detailed error messages

**No tools show up**

- Click **Test Connection** in the server settings to re-discover tools
- Verify **Enable MCP servers** is toggled on
- Check that the server's tools are compatible (MCP v1 tools)

**Tools fail to execute**

- Check that the tool hasn't been removed from the server
- Try disconnecting and reconnecting the server
- Enable Debug Mode for detailed error logs
- Tool calls have a 60-second timeout; a tool that takes longer will return a timeout error

## Timeouts and offline behavior

To prevent a slow or unreachable MCP server from hanging Obsidian, the plugin enforces these timeouts:

| Operation                                 | Timeout    |
| ----------------------------------------- | ---------- |
| Connect + first tool listing (per server) | 10 seconds |
| Tool list refresh / **Test Connection**   | 10 seconds |
| Tool invocation by the agent              | 60 seconds |
| Underlying HTTP request                   | 15 seconds |
| OAuth authorization wait                  | 2 minutes  |

These values are not user-configurable. If a working server consistently exceeds them, please open a discussion.

**Offline machines**

When the machine reports that it has no network connection (`navigator.onLine === false`), HTTP MCP servers are skipped at startup and show an "offline" error in settings. The plugin listens for the network coming back and reconnects them automatically. Stdio (local process) servers are unaffected by network state and always attempt to start.

**Startup is non-blocking**

MCP servers are connected in the background after Obsidian's layout is ready. The plugin loads immediately even if every configured MCP server is unreachable. The agent may see fewer tools for a few seconds during this connection phase.

## Limitations

- **Stdio transport**: Desktop only (Windows, macOS, Linux)
- **Tools only**: MCP resources and prompts are not yet supported
- **Restart required**: Changes to server configurations require toggling the server off and on, or restarting the plugin
- **OAuth**: Requires a browser for the authorization flow; not available on mobile for OAuth-protected servers
