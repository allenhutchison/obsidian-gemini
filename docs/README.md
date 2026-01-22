# Gemini Scribe Documentation

Welcome to the comprehensive documentation for Gemini Scribe v4.0, an Obsidian plugin that integrates Google's Gemini AI models as an intelligent agent that can actively work with your vault.

> **New in v4.0**: Gemini Scribe is now **agent-first** - every conversation is powered by an AI agent with tool-calling capabilities. The agent can search files, create notes, research topics, and execute multi-step tasks autonomously while respecting your permissions.

## Quick Navigation

### Core Features

- **[Agent Mode Guide](agent-mode-guide.md)** - Your AI assistant with tool-calling capabilities (START HERE)
- **[Custom Prompts Guide](custom-prompts-guide.md)** - Create reusable AI instruction templates
- **[AI-Assisted Writing Guide](ai-writing-guide.md)** - Rewrite and refine text with AI assistance
- **[IDE-Style Completions Guide](completions-guide.md)** - Get intelligent text suggestions as you type
- **[Document Summarization Guide](summarization-guide.md)** - Generate concise summaries automatically
- **[Context System Guide](context-system-guide.md)** - Add persistent context files to agent sessions

### Configuration & Development

- **[Settings Reference](settings-reference.md)** - Comprehensive guide to all plugin settings
- **[Advanced Settings Guide](advanced-settings-guide.md)** - Configure model parameters and developer options
- **[Tool Development Guide](tool-development-guide.md)** - Create custom tools for agent mode

### Getting Started

1. **Installation**: Install from Obsidian Community Plugins
2. **API Key**: Get your free key from [Google AI Studio](https://aistudio.google.com/apikey)
3. **Configuration**: Add your API key in Settings → Gemini Scribe
4. **Initialize Context**: Click "Initialize Vault Context" to help the agent understand your vault
5. **Start Chatting**: Open Gemini Chat and start giving the AI tasks!

## What's New in v4.0

### 🤖 Agent-First Experience

Every conversation is now an agent session with full tool-calling capabilities. No need to switch modes - the agent is always ready to help with vault operations, research, and multi-step tasks.

### 🔧 Built-in Tool Calling

The agent can:

- **Search and read** files in your vault
- **Create, modify, and organize** notes
- **Research topics** with web search and URL fetching
- **Execute complex workflows** autonomously
- **Respect your permissions** with granular controls

### 💾 Persistent Agent Sessions

- Sessions survive Obsidian restarts
- Full conversation history with tool execution logs
- Session-specific permissions and settings
- Context files that persist across the session

### 📦 Old History Archived

Your old note-based chat history from v3.x is safely preserved in the `History-Archive/` folder as readable markdown files.

## Feature Overview

### 🤖 Agent Mode (Core Feature)

An AI assistant that can actively work with your vault through tool calling.

- [Full Guide](agent-mode-guide.md)

**Example Tasks:**

- "Find all notes tagged with #important and create a summary"
- "Research quantum computing and create a new note with your findings"
- "Organize my meeting notes from this week into a weekly summary"
- "Read my project notes and suggest next steps"

### 📝 Custom Prompts

Create specialized AI behaviors for different workflows.

- [Full Guide](custom-prompts-guide.md)

**Use Cases:**

- Technical documentation templates
- Creative writing assistants
- Research note formatting
- Study guide generation

### ✍️ AI-Assisted Writing

Precisely rewrite any selected text with AI assistance.

- [Full Guide](ai-writing-guide.md)

**Example Uses:**

- "Make this more concise"
- "Fix grammar and spelling"
- "Make it more formal/casual"
- "Expand with more detail"

### ⚡ Smart Completions

Get real-time, context-aware text suggestions as you type.

- [Full Guide](completions-guide.md)

**Features:**

- IDE-style inline suggestions
- Context-aware predictions
- Accept with Tab, dismiss with any key
- Minimal latency with Gemini Flash-8B

### 📋 Auto Summarization

Generate one-sentence summaries stored in frontmatter.

- [Full Guide](summarization-guide.md)

**Benefits:**

- Quick overviews of long notes
- Searchable metadata
- Note index generation
- Document organization

### 🔗 Agent Context Files

Add specific notes as persistent context for your agent sessions.

- [Full Guide](context-system-guide.md)

**How It Works:**

- Type @ in chat to mention files
- Context files persist throughout the session
- Agent can reference and analyze context
- Perfect for focused research and analysis

## Common Agent Workflows

### Research Assistant

```
You: Research the latest developments in quantum computing and create
     a comprehensive note with citations

Agent: I'll help you with that. Let me:
1. Search the web for recent quantum computing developments
2. Fetch and analyze relevant sources
3. Create a structured note with findings and citations
```

### Vault Organization

```
You: Find all my meeting notes from October and organize them by project

Agent: I'll organize your meeting notes. Let me:
1. Search for meeting notes from October
2. Analyze their content to identify projects
3. Create project folders and move notes accordingly
```

### Knowledge Synthesis

```
You: Read all notes tagged #machine-learning and create a study guide

Agent: I'll create a comprehensive study guide. Let me:
1. Find all notes with the #machine-learning tag
2. Read and analyze their content
3. Organize key concepts and create a structured guide
```

### Content Creation

```
You: Based on my daily notes this week, write a weekly reflection

Agent: I'll create your weekly reflection. Let me:
1. Search for your daily notes from this week
2. Read and analyze the entries
3. Draft a thoughtful weekly reflection summarizing key themes
```

## Best Practices

### 1. Start with the Agent

- The agent is your primary interface - use it for everything
- Be specific about what you want the agent to do
- Let the agent break down complex tasks into steps
- Review and approve actions when needed

### 2. Initialize Vault Context

- Use "Initialize Vault Context" to help the agent understand your vault
- Update it periodically as your vault grows
- The agent uses this to better understand your organization

### 3. Use Context Files

- Add relevant notes as context for focused sessions
- Context files help the agent understand your specific needs
- Perfect for project-specific work or research

### 4. Set Appropriate Permissions

- Configure which operations require confirmation
- Use session-level permissions for trusted workflows
- Balance convenience with safety

### 5. Leverage Persistent Sessions

- Continue conversations across Obsidian restarts
- Build on previous work in the same session
- Use descriptive session titles for organization

## Troubleshooting Quick Reference

### Common Issues

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

## Plugin Settings Overview

### Essential Settings

- **API Key**: Your Gemini API key (required)
- **Chat Model**: AI model for agent conversations (default: Gemini 2.5 Pro)
- **Plugin State Folder**: Where agent sessions and data are stored (default: gemini-scribe)

### Agent Permissions

Configure which operations require confirmation:

- Create files
- Modify files
- Delete files
- Move/rename files

### Model Selection

- **Agent/Chat**: Gemini 2.5 Pro (default, most capable)
- **Completions**: Gemini Flash Lite Latest (default, fastest)
- **Summary**: Gemini Flash Latest (default, balanced speed/quality)

### Advanced Settings

- **Temperature**: Control AI creativity (0-2.0, dynamically adjusted per model)
- **Top P**: Control response diversity (0-1.0)
- **Model Discovery**: Automatic model updates from Google API
- **Tool Loop Detection**: Prevent infinite tool execution loops
- **Developer Options**: Advanced debugging and configuration

_See the [Advanced Settings Guide](advanced-settings-guide.md) for detailed configuration instructions._

## Support and Resources

### Getting Help

- **Documentation**: You're here!
- **GitHub Issues**: [Report bugs or request features](https://github.com/allenhutchison/obsidian-gemini/issues)
- **Release Notes**: Use "View Release Notes" command to see what's new

### Contributing

- See [CLAUDE.md](../CLAUDE.md) for development guidelines
- Pull requests welcome
- Create custom tools and share them
- Report your agent workflow successes

## Privacy and Security

### Data Handling

- All API calls go directly to Google's Gemini API
- No third-party servers involved
- Agent sessions stored locally in your vault
- Your data never leaves your control

### Best Practices

- Review API key permissions at Google AI Studio
- Don't share sensitive data in agent conversations
- Use vault encryption if working with confidential information
- Regular backups recommended (agent sessions are just markdown files)
- Review tool execution logs in session files

### Safety Features

- Tool loop detection prevents runaway executions
- System folders protected from modifications
- Granular permission controls per operation
- Session-level permission overrides for trusted workflows
- All tool calls logged in session history

## Quick Tips

1. **Initialize Context First**: Help the agent understand your vault structure
2. **Be Specific**: Clear requests get better results
3. **Use Context Files**: Add relevant notes with @ mentions
4. **Review Sessions**: Check session files to see exactly what the agent did
5. **Set Hotkeys**: Configure keyboard shortcuts for frequent commands
6. **Trust but Verify**: Review agent actions, especially for destructive operations
7. **Session Management**: Use descriptive titles and organize sessions by project

## What's Different from v3.x?

### Removed

- ❌ Note-based chat mode (replaced by agent sessions)
- ❌ Per-note chat history (replaced by persistent agent sessions)
- ❌ Mode switching (agent is always available)

### Added

- ✅ Tool calling in every conversation
- ✅ Persistent agent sessions
- ✅ Vault context initialization (AGENTS.md)
- ✅ Session-specific permissions
- ✅ Context file system with @ mentions
- ✅ Tool execution logging
- ✅ Update notifications with release notes

### Migrated

- 📦 Old chat history → `History-Archive/` (readable markdown)
- 🔄 Settings automatically updated
- 🆕 Fresh start with agent sessions

## Next Steps

1. **[Read the Agent Mode Guide](agent-mode-guide.md)** - Learn how to work with the agent
2. **Initialize Vault Context** - Click the button in an empty agent session
3. **Try example tasks** - Start with simple requests and build up
4. **Explore custom prompts** - Create templates for your workflows
5. **Check the settings** - Configure permissions and models to your preference

---

_Gemini Scribe v4.0 represents a major evolution toward an agent-first experience. The AI is no longer just a chat interface - it's an active collaborator that can work with your vault to help you think, organize, and create._
