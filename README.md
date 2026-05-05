# Gemini Scribe for Obsidian

Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models, providing powerful AI-driven assistance for note-taking, writing, and knowledge management directly within Obsidian. It leverages your notes as context for AI interactions, making it a highly personalized and integrated experience.

> **Note:** Pick one of two setup paths in plugin settings → **Provider**:
>
> - **Google Gemini (cloud)** — requires a Gemini API key (free tier available at [Google AI Studio](https://aistudio.google.com/apikey)).
> - **Ollama (local)** — runs locally with no API key; install [Ollama](https://ollama.com), pull a model, and select it in settings. See [docs/guide/ollama-setup.md](docs/guide/ollama-setup.md) for the feature-parity table.

## What's New in v4.7.0

**✨ Projects, Session Memory & File Shelf**

- **📂 Projects** - Scope agent sessions to a folder with custom instructions, permission overrides, and skill filters. See the [Projects guide](docs/guide/projects.md).
- **🧠 Session recall** - The agent can search past conversations for relevant context via the `recall_sessions` tool.
- **📦 Bundled skills** - Built-in help and Obsidian-knowledge skills, auto-generated from the docs site at build time.
- **📄 Binary file awareness in tools** - `read_file` can return images, audio, video, and PDFs directly to the model when encountered during tool execution.
- **🏗️ Layered prompt architecture** - System prompts refactored into composable Handlebars sections.

**Previous Updates (v4.6.0):**

- **📝 Diff review view** - Side-by-side diff for `write_file`, `append_content`, `create_skill`, and `edit_skill` with inline editing before approval
- **✏️ edit_skill tool** - Update existing skill instructions through the agent
- **🔧 get_workspace_state** - Comprehensive workspace snapshot replacing the old `get_active_file`
- **📎 Binary files in @ mentions** - File picker supports images, PDFs, audio, and video alongside text
- **🗂️ Folder re-expansion** - Folders in context auto-include newly created files on each turn

## Features

- **Agent Mode with Tool Calling:** An AI agent that can actively work with your vault! It can search for files, read content, create new notes, edit existing ones, move and rename files, create folders, and even conduct deep research with proper citations. Features persistent sessions, granular permission controls, session-specific model configuration, and a diff review view that lets you inspect and edit proposed file changes before they're written.
- **Semantic Vault Search:** [Experimental] Search your vault by meaning, not just keywords. Uses Google's File Search API to index your notes in the background. The AI can find relevant content even when you don't remember exact words. Supports PDFs and attachments, with pause/resume controls and detailed status tracking.
- **Context-Aware Agent:** Add specific notes as persistent context for your agent sessions. The agent can access and reference these context files throughout your conversation, providing highly relevant and personalized responses.
- **Smart Summarization:** Quickly generate concise, one-sentence summaries of your notes and automatically store them in the document's frontmatter, using a dedicated Gemini model optimized for summarization.
- **Selection-Based AI Features:** Work with selected text in powerful ways:
  - **Rewrite**: Transform selected text with custom instructions - right-click and choose "Gemini Scribe: Rewrite Text..."
  - **Explain Selection**: Get AI explanations using customizable prompts - right-click and choose "Gemini Scribe: Apply Prompt..."
  - **Ask about Selection**: Ask any question about selected text - right-click and choose "Gemini Scribe: Ask Question..."
- **IDE-Style Completions:** Get real-time, context-aware text completions as you type, similar to IDEs. Accept completions with `Tab` or dismiss with any other key. This feature uses a dedicated Gemini model for optimized completion generation.
- **Persistent Agent Sessions:** Store your agent conversation history directly in your vault as markdown files. Each session is stored in the `gemini-scribe/Agent-Sessions/` folder, making it easy to backup, version control, and continue conversations across sessions.
- **Configurable Models:** Choose different Gemini models for chat, summarization, and completions, allowing you to tailor the AI's behavior to each task.
- **Custom Prompt System:** Create reusable AI instruction templates for agent sessions, allowing you to customize the AI's behavior for different workflows (e.g., technical documentation, creative writing, research). Includes command palette commands for easy creation and management.
- **Image Paste Support:** Paste images directly into the chat input to send them to Gemini for multimodal analysis. Images are automatically saved to your Obsidian attachment folder, displayed as thumbnails before sending, and the AI receives the image path for embedding in notes.
- **MCP Server Support:** [Experimental] Connect to [Model Context Protocol](https://modelcontextprotocol.io/) servers to extend the agent with external tools. Supports stdio (desktop) and HTTP transports (all platforms including mobile), with OAuth authentication for remote servers. Configure per-tool trust settings with seamless integration into the confirmation flow.
- **Scheduled Tasks:** Automate recurring AI prompts — daily summaries, weekly reports, periodic vault maintenance — without manual intervention. Create and manage tasks from the **Open Scheduler** command or Settings → General → Scheduled Tasks. Each task has a frontmatter schedule (`daily`, `daily@HH:MM`, `weekly`, `weekly@HH:MM:DAYS`, `interval:Xm`, etc.) and a prompt body; tasks run as headless agent sessions and write output to your vault. Supports per-task model and tool-category overrides, catch-up runs for tasks missed while Obsidian was closed (`runIfMissed: true`), automatic pause after repeated failures, and a task monitor via the command palette.
- **Lifecycle Hooks:** [Opt-in] Trigger headless AI agent runs in response to vault events — file created, modified, deleted, or renamed. Create and manage hooks from the **Open Hook Manager** command or Settings → General → Lifecycle Hooks. Each hook specifies a trigger, an optional path glob and frontmatter filter, and a prompt template; runs include debounce, per-hour rate limits, cooldown, and auto-pause guards to keep API costs in check. Requires enabling the `hooksEnabled` setting.
- **Projects:** Create scoped agent profiles for different areas of your vault. A project bundles custom instructions, file scope, skill selection, and permission overrides into a single configuration. The agent auto-detects projects from your folder structure and applies project-specific behavior — including scoped file discovery, filtered skills, and per-tool permission overrides. See the [Projects guide](https://allenhutchison.github.io/obsidian-gemini/guide/projects) for details and the [blog post](https://allen.hutchison.org/2026/04/09/scoping-ai-context-with-projects-in-gemini-scribe/) for a walkthrough.
- **Agent Skills:** Create, edit, and use extensible skill packages that give the agent specialized knowledge and workflows. Skills follow the [agentskills.io](https://agentskills.io) specification and are stored in your plugin state folder. The agent automatically discovers available skills and activates them on demand. Update existing skills via the `edit_skill` tool with diff review.
- **Built-in Prompt Templates:** The plugin uses carefully crafted Handlebars templates for system prompts, agent prompts, summarization prompts, selection rewrite prompts, and completion prompts. These ensure consistent and effective AI interaction.
- **Data Privacy:** All interactions with the Gemini API are done directly from your machine. No data is sent to any third-party servers other than Google's. Agent session history is stored locally in your Obsidian vault as markdown files.
- **Robust Session Management:**
  - Persistent agent sessions that survive restarts
  - Session-specific permissions and settings
  - Context files that persist across the session
  - Full conversation history with tool execution logs
  - Easy backup and version control of sessions
  - Automatic context compaction when conversations grow large
  - Optional token usage display showing real-time context consumption

## Quick Start

1. Install the plugin from Community Plugins
2. Get your free API key from [Google AI Studio](https://aistudio.google.com/apikey)
3. Add the API key in plugin settings
4. Open Agent Chat with the ribbon icon or command palette
5. Start using the AI agent to work with your vault!

**Prefer running models locally?** Gemini Scribe also supports [Ollama](https://ollama.com) — install Ollama, pull a model with `ollama pull llama3.2`, and switch the **Provider** in settings to "Ollama (local)". A few Gemini-built-in features (Google Search, URL Context, Deep Research, image generation, RAG) are unavailable on Ollama; see [docs/guide/ollama-setup.md](docs/guide/ollama-setup.md) for details.

## Installation

1.  **Community Plugins (Recommended):**
    - Open Obsidian Settings.
    - Navigate to "Community plugins".
    - Ensure "Restricted mode" is OFF.
    - Click "Browse" and search for "Gemini Scribe".
    - Click "Install" and then "Enable".

2.  **Manual Installation:**
    - Download the latest release from the [GitHub Releases](https://github.com/allenhutchison/obsidian-gemini/releases) page (you'll need `main.js`, `manifest.json`, and `styles.css`).
    - Create a folder named `obsidian-gemini` inside your vault's `.obsidian/plugins/` directory.
    - Copy the downloaded files into the `obsidian-gemini` folder.
    - In Obsidian, go to Settings → Community plugins and enable "Gemini Scribe".

## Configuration

1.  **Obtain a Gemini API Key:**
    - Visit the [Google AI Studio](https://aistudio.google.com/apikey).
    - Create a new API key.

2.  **Configure Plugin Settings:**
    - Open Obsidian Settings.
    - Go to "Gemini Scribe" under "Community plugins".
    - **Provider:** Choose `Google Gemini (cloud)` (default) or `Ollama (local)`. The Ollama option exposes a base-URL field and refreshes the model list from `GET /api/tags`.
    - **API Key:** (Gemini only) Paste your Gemini API key here. Your key is stored securely using Obsidian's SecretStorage.
    - **Chat Model:** Select the preferred Gemini model for chat interactions (default: `gemini-flash-latest`).
    - **Summary Model:** Select the preferred Gemini model for generating summaries (default: `gemini-flash-latest`).
    - **Completion Model:** Select the preferred model for IDE-style completions (default: `gemini-flash-lite-latest`).
    - **Summary Frontmatter Key:** Specify the key to use when storing summaries in the frontmatter (default: `summary`).
    - **Your Name:** Enter your name, which the AI will use when addressing you.
    - **Chat History:**
      - **Enable Session History:** Toggle whether to save agent session history.
      - **Plugin State Folder:** Choose the folder within your vault to store plugin data (agent sessions and custom prompts).
    - **Custom Prompts:**
      - **Allow System Prompt Override:** Allow custom prompts to completely replace the system prompt (use with caution).
    - **UI Settings:**
      - **Enable Streaming:** Toggle streaming responses for a more interactive chat experience.
    - **Advanced Settings:** (Click "Show Advanced Settings" to reveal)
      - **Temperature:** Control AI creativity and randomness (0-2.0, automatically adjusted based on available models).
      - **Top P:** Control response diversity and focus (0-1.0).
      - **Model Discovery:** Gemini models are automatically fetched on startup; Ollama users can click **Refresh model list** after pulling new models.
      - **API Configuration:** Configure retry behavior and backoff delays.
      - **Tool Execution:** Control whether to stop agent execution on tool errors.
      - **Tool Loop Detection:** Prevent infinite tool execution loops.
      - **Developer Options:** Debug mode, file logging, and advanced configuration tools.

## Usage

### Agent Mode

Let the AI actively work with your vault through tool calling capabilities.

**Quick Start:**

1. Open Agent Chat with the command palette or ribbon icon
2. Ask the agent to help with vault operations
3. Review and approve actions (if confirmation is enabled)

**Available Tools:**

- **Search Files by Name:** Find any file by filename patterns (wildcards supported)
- **Search File Contents:** Grep-style text search within note contents (supports regex and case-sensitive search)
- **Read Files:** Access text files or analyze binary files (images, audio, video, PDF) directly through Gemini
- **Create Notes:** Generate new notes with specified content
- **Edit Notes:** Modify existing notes with precision
- **Move/Rename Files:** Reorganize and rename notes in your vault
- **Delete Notes:** Remove notes or folders (with confirmation)
- **Create Folders:** Organize your vault with new folder structures
- **List Files:** Browse vault directories and their contents
- **Web Search:** Search Google for current information (if enabled)
- **Fetch URLs:** Retrieve and analyze web content
- **Deep Research:** Conduct comprehensive multi-source research with citations
- **Agent Skills:** Activate specialized skill packages for domain-specific tasks

**Key Features:**

- **Persistent Sessions:** Continue conversations across Obsidian restarts
- **Permission Controls:** Choose which tools require confirmation
- **Context Files:** Add specific notes as persistent context
- **Session Configuration:** Override model, temperature, and prompt per session
- **Safety Features:** System folders are protected from modifications
- **Tool Permissions**: Granular per-tool permission system with presets (Read Only, Cautious, Edit Mode, YOLO) and per-tool overrides. Control which tools run automatically, which require confirmation, and which are disabled entirely.
- **Additional Tools**:
  - `update_frontmatter`: Safely modify note properties (status, tags, dates) without rewriting content
  - `append_content`: Efficiently add text to the end of notes (great for logs and journals)

**Example Commands:**

- "Find all notes about project planning"
- "Create a new note summarizing my meeting notes from this week"
- "Research the latest developments in quantum computing and save a report"
- "Analyze my daily notes and identify common themes"
- "Move all completed project notes to an archive folder"
- "Search for information about the Zettelkasten method and create a guide"

### Custom Prompts

Create reusable AI instruction templates to customize behavior for different types of content.

**Quick Start:**

1. Create a prompt file in `[Plugin State Folder]/Prompts/`
2. Open the agent panel and click the gear icon in the session header
3. Select your prompt from the "Prompt Template" dropdown

**Learn More:** See the comprehensive [Custom Prompts Guide](docs/guide/custom-prompts.md) for detailed instructions, examples, and best practices.

### Documentation

For detailed guides on all features, visit the [Documentation Site](https://allenhutchison.github.io/obsidian-gemini/):

**Core Features:**

- [Agent Mode Guide](docs/guide/agent-mode.md) - AI agent with tool-calling capabilities
- [Custom Prompts Guide](docs/guide/custom-prompts.md)
- [AI-Assisted Writing Guide](docs/guide/ai-writing.md)
- [Completions Guide](docs/guide/completions.md)
- [Summarization Guide](docs/guide/summarization.md)
- [Context System Guide](docs/guide/context-system.md)
- [MCP Servers Guide](docs/guide/mcp-servers.md) - Connect external tool servers
- [Agent Skills Guide](docs/guide/agent-skills.md) - Create extensible AI skill packages
- [Scheduled Tasks Guide](docs/guide/scheduled-tasks.md) - Automate recurring AI prompts
- [Lifecycle Hooks Guide](docs/guide/lifecycle-hooks.md) - Trigger AI runs from vault events

**Configuration & Development:**

- [Settings Reference](docs/reference/settings.md) - Complete settings documentation
- [Advanced Settings Guide](docs/reference/advanced-settings.md)
- [Tool Development Guide](docs/contributing/tool-development.md) - Create custom agent tools

### Chat Interface

1.  **Open Chat:**
    - Use command palette "Gemini Scribe: Open Gemini Chat" or click the ribbon icon
    - All chats now have full agent capabilities with tool calling

2.  **Chat with Context:**
    - Type your message in the input box
    - Press **Enter** to send, **Shift+Enter** for new lines (newlines are preserved in the message)
    - The AI automatically includes your current note as context
    - Use **@** to mention files (text, binary, or folders) as persistent context
    - Sessions are automatically saved and can be resumed

3.  **AI Responses:**
    - Responses appear in the chat with a "Copy" button
    - Custom prompts modify how the AI responds (if configured)
    - Tool calls and results are shown in collapsible sections for clarity

### Document Summarization

1.  **Open a Note:** Navigate to the Markdown file you want to summarize
2.  **Generate Summary:** Press Ctrl/Cmd + P and run "Gemini Scribe: Summarize Active File"
3.  **View Result:** The summary is added to your note's frontmatter (default key: `summary`)

**Tip:** Great for creating quick overviews of long notes or generating descriptions for note indexes.

### Selection-Based Text Rewriting

Precisely rewrite any portion of your text with AI assistance. This feature provides surgical precision for improving specific sections without affecting the rest of your document.

1.  **Select Text:** Highlight the text you want to rewrite in any Markdown file.
2.  **Access Rewrite Options:**
    - **Right-click method:** Right-click the selected text and choose "Rewrite with Gemini"
    - **Command method:** Use the command palette (Ctrl/Cmd + P) and search for "Rewrite selected text with AI"
3.  **Provide Instructions:** A modal will appear showing your selected text. Enter instructions for how you'd like it rewritten (e.g., "Make this more concise", "Fix grammar", "Make it more formal").
4.  **Review and Apply:** The AI will rewrite only your selected text based on your instructions, maintaining consistency with the surrounding content.

**Examples of rewrite instructions:**

- "Make this more concise"
- "Fix grammar and spelling"
- "Make it more formal/casual"
- "Expand with more detail"
- "Simplify the language"
- "Make it more technical"

**Benefits:**

- **Precise control:** Only rewrites what you select
- **Context-aware:** Maintains consistency with surrounding text and linked documents
- **Safe:** No risk of accidentally modifying your entire document
- **Intuitive:** Natural text editing workflow

### IDE-Style Completions

1.  **Toggle Completions:** Use the command palette (Ctrl/Cmd + P) and select "Gemini Scribe: Toggle completions". A notice will confirm whether completions are enabled or disabled.
2.  **Write:** Begin typing in a Markdown file.
3.  **Suggestions:** After a short pause in typing (750ms), Gemini will provide an inline suggestion based on your current context.
4.  **Accept/Dismiss:**
    - Press `Tab` to accept the suggestion.
    - Press any other key to dismiss the suggestion and continue typing.
5.  **Context-Aware:** Completions consider the surrounding text and document structure for more relevant suggestions.

### Chat History

- **Sessions in your vault:** Agent sessions are stored as markdown files under `[Plugin State Folder]/Agent-Sessions/`, making them easy to browse, back up, and version-control.
- **Browse and resume:** Use the session dropdown in the agent panel to load a previous session and continue the conversation.
- **Manual management:** Sessions are plain markdown — delete the files in `Agent-Sessions/` to remove old conversations. There is no in-app "clear all" command.
- **Automatic management:** The plugin automatically:
  - Creates a session file the first time you send a message
  - Adds a YYYY-MM-DD prefix and an AI-generated description to the session title after the first exchange
  - Tracks every file the agent reads or writes in `accessed_files` frontmatter for audit and recall

### Custom Prompts

Create reusable AI instruction templates that customize how the AI behaves for specific sessions.

1. **Create New Prompts:**
   - Use the command palette: "Gemini Scribe: Create New Custom Prompt"
   - Enter a name and edit the generated template
   - Or manually create `.md` files in `[Plugin State Folder]/Prompts/`

2. **Apply to Sessions:**
   - Open the agent panel and click the gear icon in the session header
   - Select your prompt from the "Prompt Template" dropdown
   - The prompt applies to all messages in that session

**Tip:** See the comprehensive [Custom Prompts Guide](docs/guide/custom-prompts.md) for examples and best practices.

## Troubleshooting

- **API Key Errors:** Ensure your API key is correct and has the necessary permissions. Get a new key at [Google AI Studio](https://aistudio.google.com/apikey).
- **No Responses:** Check your internet connection and make sure your API key is valid.
- **Slow Responses:** The speed of responses depends on the Gemini model and the complexity of your request. Larger context windows will take longer.
- **Completions Not Showing:**
  - Ensure completions are enabled via the command palette
  - Try typing a few words and pausing to trigger the suggestion
  - Check that you're in a Markdown file
  - Disable other completion plugins that might conflict
- **Sessions Not Loading:** Ensure "Enable Session History" is on and the "Plugin State Folder" path is correct. Sessions live under `[Plugin State Folder]/Agent-Sessions/`.
- **Custom Prompts Not Working:**
  - Ensure "Enable Custom Prompts" is toggled on in settings
  - Verify the prompt file exists in the Prompts folder
  - Check that the prompt is selected in session settings (gear icon)
  - See the [Custom Prompts Guide](docs/guide/custom-prompts.md) for detailed troubleshooting
- **Parameter/Advanced Settings Issues:**
  - Check if your model supports the temperature range you're using
  - Reset temperature and Top P to defaults if getting unexpected responses
  - Restart Obsidian to trigger a fresh model list fetch (for Gemini), or click **Refresh model list** (for Ollama)
  - See the [Advanced Settings Guide](docs/reference/advanced-settings.md) for detailed configuration help
- **Agent Mode / Tool Issues:**
  - Verify your Gemini model supports function calling (all Gemini 2.0+ models do)
  - If tools fail, check file permissions and paths
  - System folders (plugin state folder, .obsidian) are protected from modifications
  - For session issues, try creating a new session from the chat interface
  - Check the console (Ctrl/Cmd + Shift + I) or enable "Log to file" in settings and review `debug.log` in the plugin state folder for detailed error messages
  - Tool loop detection may stop repeated operations - adjust settings if needed

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Report issues or suggest features on [GitHub](https://github.com/allenhutchison/obsidian-gemini/issues).
- Visit [author's website](https://allen.hutchison.org) for more information.

## Development

Contributions are welcome! See [CLAUDE.md](CLAUDE.md) for development guidelines and architecture details.

```bash
npm install     # Install dependencies
npm run dev     # Development build with watch
npm run build   # Production build
npm test        # Run tests
```

## Credits

Created by Allen Hutchison
