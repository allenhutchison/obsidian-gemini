# Getting Started

Welcome to Gemini Scribe, an Obsidian plugin that integrates Google's Gemini AI models as an intelligent agent that can actively work with your vault.

> **Gemini Scribe is agent-first** — every conversation is powered by an AI agent with tool-calling capabilities. The agent can search files, create notes, research topics, and execute multi-step tasks autonomously while respecting your permissions.

## Installation

### Community Plugins (Recommended)

1. Open Obsidian Settings
2. Navigate to "Community plugins"
3. Ensure "Restricted mode" is OFF
4. Click "Browse" and search for "Gemini Scribe"
5. Click "Install" and then "Enable"

### Manual Installation

1. Download the latest release from the [GitHub Releases](https://github.com/allenhutchison/obsidian-gemini/releases) page (you'll need `main.js`, `manifest.json`, and `styles.css`)
2. Create a folder named `obsidian-gemini` inside your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the `obsidian-gemini` folder
4. In Obsidian, go to Settings → Community plugins and enable "Gemini Scribe"

## Quick Start

1. **Get an API Key** — Get your free key from [Google AI Studio](https://aistudio.google.com/apikey)
2. **Configure** — Add your API key in Settings → Gemini Scribe
3. **Initialize Context** — Click "Initialize Vault Context" to help the agent understand your vault
4. **Start Chatting** — Open Gemini Chat with the ribbon icon or command palette and start giving the AI tasks!

## Feature Overview

### Agent Mode (Core Feature)

An AI assistant that can actively work with your vault through tool calling.

- Search and read files in your vault
- Create, modify, and organize notes
- Research topics with web search and URL fetching
- Execute complex workflows autonomously
- Respect your permissions with granular controls

**Example tasks:**

- "Find all notes tagged with #important and create a summary"
- "Research quantum computing and create a new note with your findings"
- "Organize my meeting notes from this week into a weekly summary"

[Full Agent Mode Guide →](/guide/agent-mode)

### Custom Prompts

Create specialized AI behaviors for different workflows — technical documentation, creative writing, research formatting, and more.

[Custom Prompts Guide →](/guide/custom-prompts)

### AI-Assisted Writing

Work with selected text using AI — rewrite, explain, or ask questions about any selection.

[AI Writing Guide →](/guide/ai-writing)

### IDE-Style Completions

Get real-time, context-aware text suggestions as you type, similar to code completion in programming IDEs.

[Completions Guide →](/guide/completions)

### Smart Summarization

Generate concise, one-sentence summaries stored in frontmatter for easy access and organization.

[Summarization Guide →](/guide/summarization)

### Context System

Add specific notes as persistent context for your agent sessions using @ mentions.

[Context System Guide →](/guide/context-system)

## Best Practices

1. **Start with the Agent** — The agent is your primary interface. Be specific about what you want it to do and let it break down complex tasks into steps.
2. **Initialize Vault Context** — Use "Initialize Vault Context" to help the agent understand your vault. Update it periodically as your vault grows.
3. **Use Context Files** — Add relevant notes as context with @ mentions for focused sessions.
4. **Set Appropriate Permissions** — Configure which operations require confirmation. Balance convenience with safety.
5. **Leverage Persistent Sessions** — Continue conversations across Obsidian restarts and build on previous work.

## Troubleshooting

**Agent Not Responding**

- Check API key validity in Settings
- Verify internet connection
- Ensure your model supports tool calling (all current models support this)

**Tools Failing**

- Check file permissions and paths
- Verify files exist and are accessible
- System folders (.obsidian, plugin folders) are protected from modifications

**Poor Quality Output**

- Add specific notes as context files
- Be more specific in your requests
- Try Gemini 2.5 Pro for more capable responses

**Performance Issues**

- Use Gemini Flash for faster responses
- Reduce context file count for quicker processing
- Break up large requests into smaller tasks

**Session Issues**

- Try creating a new session
- Check console (Ctrl/Cmd + Shift + I) for errors
- Verify session files aren't corrupted

For detailed configuration, see the [Settings Reference](/reference/settings) and [Advanced Settings Guide](/reference/advanced-settings).

## Further Reading

- [Introducing Gemini Scribe: Your AI Writing Assistant for Obsidian](https://allen.hutchison.org/2024/11/23/introducing-gemini-scribe-your-ai-writing-assistant-for-obsidian/) — The original announcement and motivation behind the plugin
- [Gemini Scribe Supercharged: A Faster, More Powerful Workflow Awaits](https://allen.hutchison.org/2025/07/03/gemini-scribe-supercharged-a-faster-more-powerful-workflow-awaits/) — Major upgrades including streaming, prompt system, and model controls
- [Great Video on Gemini Scribe and Obsidian](https://allen.hutchison.org/2026/02/01/great-video-on-gemini-scribe-and-obsidian/) — A deep dive video exploring Gemini Scribe as an autonomous engine for a self-organizing second brain
