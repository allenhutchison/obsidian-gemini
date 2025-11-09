# Gemini Scribe for Obsidian

Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models, providing powerful AI-driven assistance for note-taking, writing, and knowledge management directly within Obsidian. It leverages your notes as context for AI interactions, making it a highly personalized and integrated experience.

> **Note:** This plugin requires a Google Gemini API key. Free tier available at [Google AI Studio](https://aistudio.google.com/apikey).

## What's New in v4.0.0

**🎉 Major Update: Unified Agent-First Experience**

This release simplifies Gemini Scribe by focusing entirely on the powerful Agent Mode with tool calling:

- **🤖 Single Unified Chat Interface:** Streamlined to one powerful agent mode with full tool calling - no more switching between modes!
- **📦 History Archival:** Old note-based chat history is safely archived (not converted) when upgrading, preserving your conversations as readable markdown
- **🎉 Welcome Experience:** Friendly welcome modal explains v4.0 changes and offers optional history archival
- **🗑️ Simplified Codebase:** Removed legacy note-based chat and migration code - focused entirely on agent capabilities

**What This Means:**
- All conversations now support tool calling and agent features by default
- Cleaner, more intuitive interface focused on what works best
- Your old chat history is preserved as-is in an archive folder
- Start fresh with powerful agent sessions featuring persistent context and permissions

**Previous Updates:**
- **🎯 Selection-Based Text Rewriting:** Precisely rewrite any selected text with AI assistance
- **Dynamic Model Parameter Controls:** Automatic discovery of temperature and Top P ranges
- **Model Discovery System:** Automatic fetching of the latest Gemini models
- **Enhanced Custom Prompts System:** Improved prompt management with better tracking
- **Improved Plugin Compatibility:** Native Obsidian APIs for better plugin compatibility

## Features

- **Agent Mode with Tool Calling:** An AI agent that can actively work with your vault! It can search for files, read content, create new notes, edit existing ones, move and rename files, create folders, and even conduct deep research with proper citations. Features persistent sessions, granular permission controls, and session-specific model configuration.
- **Context-Aware Agent:** Add specific notes as persistent context for your agent sessions. The agent can access and reference these context files throughout your conversation, providing highly relevant and personalized responses.
- **Smart Summarization:** Quickly generate concise, one-sentence summaries of your notes and automatically store them in the document's frontmatter, using a dedicated Gemini model optimized for summarization.
- **Selection-Based Text Rewriting:** Precisely rewrite any selected text with AI assistance. Simply select the text you want to improve, right-click to choose "Rewrite with Gemini", and provide instructions for how you'd like it rewritten.
- **IDE-Style Completions:** Get real-time, context-aware text completions as you type, similar to IDEs. Accept completions with `Tab` or dismiss with any other key. This feature uses a dedicated Gemini model for optimized completion generation.
- **Persistent Agent Sessions:** Store your agent conversation history directly in your vault as markdown files. Each session is stored in the `gemini-scribe/Agent-Sessions/` folder, making it easy to backup, version control, and continue conversations across sessions.
- **Configurable Models:** Choose different Gemini models for chat, summarization, and completions, allowing you to tailor the AI's behavior to each task.
- **Custom Prompt System:** Create reusable AI instruction templates for agent sessions, allowing you to customize the AI's behavior for different workflows (e.g., technical documentation, creative writing, research). Includes command palette commands for easy creation and management.
- **Built-in Prompt Templates:** The plugin uses carefully crafted Handlebars templates for system prompts, agent prompts, summarization prompts, selection rewrite prompts, and completion prompts. These ensure consistent and effective AI interaction.
- **Data Privacy:** All interactions with the Gemini API are done directly from your machine. No data is sent to any third-party servers other than Google's. Agent session history is stored locally in your Obsidian vault as markdown files.
- **Robust Session Management:**
  - Persistent agent sessions that survive restarts
  - Session-specific permissions and settings
  - Context files that persist across the session
  - Full conversation history with tool execution logs
  - Easy backup and version control of sessions

## Quick Start

1. Install the plugin from Community Plugins
2. Get your free API key from [Google AI Studio](https://aistudio.google.com/apikey)
3. Add the API key in plugin settings
4. Open Agent Chat with the ribbon icon or command palette
5. Start using the AI agent to work with your vault!

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
    - **API Key:** Paste your Gemini API key here.
    - **Chat Model:** Select the preferred Gemini model for chat interactions (e.g., `gemini-1.5-pro`).
    - **Summary Model:** Select the preferred Gemini model for generating summaries (e.g., `gemini-1.5-flash`).
    - **Completion Model:** Select the preferred model for IDE-style completions (e.g., `gemini-1.5-flash-8b`).
    - **Summary Frontmatter Key:** Specify the key to use when storing summaries in the frontmatter (default: `summary`).
    - **Your Name:** Enter your name, which the AI will use when addressing you.
    - **Chat History:**
      - **Enable Chat History:** Toggle whether to save agent session history.
      - **Plugin State Folder:** Choose the folder within your vault to store plugin data (agent sessions and custom prompts).
    - **Custom Prompts:**
      - **Allow System Prompt Override:** Allow custom prompts to completely replace the system prompt (use with caution).
    - **UI Settings:**
      - **Enable Streaming:** Toggle streaming responses for a more interactive chat experience.
    - **Advanced Settings:** (Click "Show Advanced Settings" to reveal)
      - **Temperature:** Control AI creativity and randomness (0-2.0, automatically adjusted based on available models).
      - **Top P:** Control response diversity and focus (0-1.0).
      - **Model Discovery:** Automatically fetch and update available Gemini models with their parameter limits.
      - **API Configuration:** Configure retry behavior and backoff delays.
      - **Tool Execution:** Control whether to stop agent execution on tool errors.
      - **Tool Loop Detection:** Prevent infinite tool execution loops.
      - **Developer Options:** Debug mode and advanced configuration tools.

## Usage

### Agent Mode

Let the AI actively work with your vault through tool calling capabilities.

**Quick Start:**
1. Open Agent Chat with the command palette or ribbon icon
2. Ask the agent to help with vault operations
3. Review and approve actions (if confirmation is enabled)

**Available Tools:**
- **Search Files:** Find notes by name or content patterns
- **Read Files:** Access and analyze note contents
- **Create Notes:** Generate new notes with specified content
- **Edit Notes:** Modify existing notes with precision
- **Move/Rename Files:** Reorganize and rename notes in your vault
- **Delete Notes:** Remove notes or folders (with confirmation)
- **Create Folders:** Organize your vault with new folder structures
- **List Files:** Browse vault directories and their contents
- **Web Search:** Search Google for current information (if enabled)
- **Fetch URLs:** Retrieve and analyze web content
- **Deep Research:** Conduct comprehensive multi-source research with citations

**Key Features:**
- **Persistent Sessions:** Continue conversations across Obsidian restarts
- **Permission Controls:** Choose which tools require confirmation
- **Context Files:** Add specific notes as persistent context
- **Session Configuration:** Override model, temperature, and prompt per session
- **Safety Features:** System folders are protected from modifications

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
2. Add to your note's frontmatter: `gemini-scribe-prompt: "[[Prompt Name]]"`
3. The AI will use your custom instructions for that note

**Learn More:** See the comprehensive [Custom Prompts Guide](docs/custom-prompts-guide.md) for detailed instructions, examples, and best practices.

### Documentation

For detailed guides on all features, visit the [Documentation Hub](docs/README.md):

**Core Features:**
- [Chat Interface Guide](docs/chat-interface-guide.md)
- [Agent Mode Guide](docs/agent-mode-guide.md) - AI agent with tool-calling capabilities
- [Custom Prompts Guide](docs/custom-prompts-guide.md)
- [AI-Assisted Writing Guide](docs/ai-writing-guide.md)
- [Completions Guide](docs/completions-guide.md)
- [Summarization Guide](docs/summarization-guide.md)
- [Chat History Guide](docs/chat-history-guide.md)
- [Context System Guide](docs/context-system-guide.md)

**Configuration & Development:**
- [Settings Reference](docs/settings-reference.md) - Complete settings documentation
- [Advanced Settings Guide](docs/advanced-settings-guide.md)
- [Tool Development Guide](docs/tool-development-guide.md) - Create custom agent tools

**Migration & Updates:**
- [Changelog](CHANGELOG.md) - Recent changes and migration notes

### Chat Interface

1.  **Open Chat:**

    - Use command palette "Gemini Scribe: Open Gemini Chat" or click the ribbon icon
    - All chats now have full agent capabilities with tool calling

2.  **Chat with Context:**
    - Type your message in the input box
    - Press Enter to send (Shift+Enter for new line)
    - The AI automatically includes your current note as context
    - You can add persistent context files with @ mentions
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

1.  **Toggle Completions:** Use the command palette (Ctrl/Cmd + P) and select "Gemini Scribe: Toggle Completions". A notice will confirm whether completions are enabled or disabled.
2.  **Write:** Begin typing in a Markdown file.
3.  **Suggestions:** After a short pause in typing (750ms), Gemini will provide an inline suggestion based on your current context.
4.  **Accept/Dismiss:**
    - Press `Tab` to accept the suggestion.
    - Press any other key to dismiss the suggestion and continue typing.
5.  **Context-Aware:** Completions consider the surrounding text and document structure for more relevant suggestions.

### Chat History

- **Per-Note History:** Each note's chat history is stored in a separate markdown file in the configured history folder, making it easy to manage and backup.
- **View History:** Open the history file from the chat interface or navigate to `[History Folder]/[Note Name] - Gemini History.md`
- **Clear History:** Use the command palette to run "Gemini Scribe: Clear All Chat History" to remove all history files
- **Automatic Management:** The plugin automatically:
  - Creates history files when you start chatting about a note
  - Updates links when notes are renamed or moved
  - Preserves history across Obsidian sessions

### Custom Prompts

Create reusable AI instruction templates that customize how the AI behaves for specific notes.

1. **Enable Custom Prompts:** In plugin settings, ensure "Enable Custom Prompts" is toggled ON.

2. **Create New Prompts:**
   - Use the command palette: "Gemini Scribe: Create New Custom Prompt"
   - Enter a name and edit the generated template
   - Or manually create `.md` files in `[History Folder]/Prompts/`

3. **Apply to Notes:**
   - Use command palette: "Gemini Scribe: Apply Custom Prompt to Current Note"
   - Search and select from available prompts
   - Or manually add to frontmatter: `gemini-scribe-prompt: "[[Prompt Name]]"`

4. **Remove from Notes:**
   - Use command palette: "Gemini Scribe: Remove Custom Prompt from Current Note"
   - Or manually delete the frontmatter field

**Tip:** See the comprehensive [Custom Prompts Guide](docs/custom-prompts-guide.md) for examples and best practices.

## Troubleshooting

- **API Key Errors:** Ensure your API key is correct and has the necessary permissions. Get a new key at [Google AI Studio](https://aistudio.google.com/apikey).
- **No Responses:** Check your internet connection and make sure your API key is valid.
- **Slow Responses:** The speed of responses depends on the Gemini model and the complexity of your request. Larger context windows will take longer.
- **Completions Not Showing:** 
  - Ensure completions are enabled via the command palette
  - Try typing a few words and pausing to trigger the suggestion
  - Check that you're in a Markdown file
  - Disable other completion plugins that might conflict
- **History Not Loading:** Ensure "Enable Chat History" is enabled and the "History Folder" is correctly set.
- **Custom Prompts Not Working:**
  - Ensure "Enable Custom Prompts" is toggled on in settings
  - Verify the prompt file exists in the Prompts folder
  - Check that the wikilink syntax is correct: `[[Prompt Name]]`
  - Try using the command palette commands for easier management
  - See the [Custom Prompts Guide](docs/custom-prompts-guide.md) for detailed troubleshooting
- **Parameter/Advanced Settings Issues:**
  - Check if your model supports the temperature range you're using
  - Reset temperature and Top P to defaults if getting unexpected responses
  - Enable model discovery to get latest parameter limits
  - See the [Advanced Settings Guide](docs/advanced-settings-guide.md) for detailed configuration help
- **Agent Mode / Tool Issues:**
  - Verify your Gemini model supports function calling (all Gemini 2.0+ models do)
  - If tools fail, check file permissions and paths
  - System folders (plugin state folder, .obsidian) are protected from modifications
  - For session issues, try creating a new session from the chat interface
  - Check the console (Ctrl/Cmd + Shift + I) for detailed error messages
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
