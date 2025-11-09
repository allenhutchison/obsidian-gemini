# Agent Mode Guide

Gemini Scribe v4.0 is **agent-first** - every conversation is powered by an AI assistant that can actively work with your vault through tool calling. This guide covers everything you need to know about using the agent effectively and safely.

## What is the Agent?

In v4.0, the agent is always available and can:
- Read and search files in your vault
- Create, modify, and organize notes
- Search the web for information
- Fetch and analyze web pages
- Execute multiple operations in sequence
- Work autonomously while respecting your permissions

> **New in v4.0**: Agent mode is no longer a separate feature you enable - it's the core of how Gemini Scribe works. Every chat is an agent session with full tool-calling capabilities.

## Getting Started

### 1. Open Agent Chat
- Use Command Palette: "Gemini Scribe: Open Gemini Chat"
- Or click the sparkles icon (⭐) in the ribbon
- Or use your configured hotkey

### 2. Initialize Vault Context (Recommended)
1. In an empty agent session, click "Initialize Vault Context"
2. The agent will analyze your vault structure and create AGENTS.md
3. This helps the agent understand your vault organization
4. Update periodically as your vault grows

### 3. Configure Permissions
Choose which operations require confirmation in Settings → Gemini Scribe:
- Create files
- Modify files
- Delete files
- Move/rename files

You can also set session-level permissions to bypass confirmations for trusted workflows.

## Core Features

### Tool Calling
The agent can execute various tools to help with your tasks:

```
User: Find all my meeting notes from this week and create a summary

Agent: I'll help you find and summarize your meeting notes. Let me:
1. Search for meeting notes from this week
2. Read their contents
3. Create a summary document

[Executes search_files tool]
[Executes read_file tool for each result]
[Executes write_file tool to create summary]
```

### Context Files
Add persistent context files to your session:
1. Type @ in the chat input
2. Select files from the suggestion list
3. These files remain available throughout the session

### Session Management
- Each conversation is a separate session
- Sessions persist across Obsidian restarts
- Access previous sessions from the dropdown
- Configure session-specific settings

## Available Tools

### Read-Only Tools

#### search_files
Search for files by name pattern:
```
Find all files containing "project"
Search for "*.md" files in the Projects folder
```

#### read_file
Read the contents of a specific file:
```
Read the contents of my daily note
Show me what's in Projects/Todo.md
```

#### list_files
List files in a folder:
```
Show me all files in the Archive folder
List the contents of my Templates directory
```

### Vault Operations

#### write_file
Create or update files:
```
Create a new note called "Meeting Minutes"
Update my todo list with these items
```

#### delete_file
Remove files (requires confirmation):
```
Delete the old draft file
Remove temporary notes from yesterday
```

#### move_file
Move or rename files:
```
Move completed tasks to the Archive folder
Rename "Untitled" to "Project Proposal"
```

### Web Operations

#### google_search
Search the web for current information:
```
Search for the latest Obsidian plugin development docs
Find recent research on productivity methods
```

#### fetch_url
Retrieve and analyze web page content:
```
Get the content from this documentation page
Analyze this blog post and summarize key points
```

## Session Configuration

### Session-Level Settings
Override global settings for specific conversations:
1. Click the settings icon next to session name
2. Configure:
   - Model (e.g., use GPT-4 for complex tasks)
   - Temperature (creativity level)
   - Top-P (response diversity)
   - Custom prompt template

### Permissions
Set session-specific permissions:
- Bypass confirmations for trusted operations
- Temporarily enable additional tools
- Restrict access for sensitive sessions

## Best Practices

### 1. Start with Read-Only
Begin with read-only operations to understand how the agent works:
```
Show me all my notes tagged with #important
Find notes I haven't updated in 30 days
Search for broken links in my vault
```

### 2. Use Clear Instructions
Be specific about what you want:
```
Good: "Create a weekly summary of all notes tagged #meeting from the past 7 days"
Less clear: "Summarize my meetings"
```

### 3. Review Before Confirming
When the agent proposes destructive operations:
- Read the operation details carefully
- Check file paths are correct
- Ensure backups exist for important data

### 4. Leverage Context Files
Add relevant files as context for better results:
- Template files for consistent formatting
- Style guides for writing tasks
- Reference documents for research

### 5. Use Sessions Effectively
- Create new sessions for different projects
- Name sessions descriptively
- Review session history for insights

## Advanced Usage

### Multi-Step Workflows
The agent excels at complex, multi-step tasks:

```
User: Organize my research notes. Group them by topic, create an index, and archive anything older than 6 months.

Agent: I'll help organize your research notes. This will involve:
1. Finding all research notes
2. Analyzing their topics
3. Creating topic-based folders
4. Moving files to appropriate folders
5. Creating an index file
6. Archiving old notes

Let me start by searching for research notes...
[Executes multiple tools in sequence]
```

### Template-Based Operations
Use templates for consistent results:

```
User: Create a new project using my project template

Agent: I'll create a new project structure for you.
[Reads template]
[Creates folder structure]
[Populates with template files]
[Updates project index]
```

### Research Assistant
Combine vault and web operations:

```
User: Research productivity methods and create notes for the most promising ones

Agent: I'll research productivity methods and create notes.
[Searches web for productivity methods]
[Fetches relevant articles]
[Creates structured notes]
[Links to existing notes]
```

## Safety Features

### Protected Folders
The following folders are automatically protected:
- `.obsidian/` - Plugin configurations
- `gemini-scribe/` - Plugin state files
- Any folder containing plugin data

### Loop Detection
Prevents infinite execution loops:
- Detects repeated identical operations
- Stops after threshold (default: 3)
- Configurable time window

### Error Handling
- Operations stop on errors (configurable)
- Clear error messages explain failures
- Non-destructive fallback behaviors

### Confirmation System
- Destructive operations require confirmation
- Bypass on per-session basis for trusted workflows
- Visual indicators for operation types

## Troubleshooting

### Agent Not Responding
1. Check agent mode is enabled
2. Verify API key supports function calling
3. Ensure selected model supports tools (e.g., Gemini 1.5 Pro)

### Tools Not Available
1. Check tool category is enabled in settings
2. Verify session has proper permissions
3. Some tools may be incompatible with search grounding

### Operations Failing
1. Check file paths are correct
2. Ensure you have vault permissions
3. Verify files aren't open in other applications
4. Check for protected folder restrictions

### Performance Issues
1. Reduce number of context files
2. Use more specific search patterns
3. Break complex tasks into steps
4. Consider using faster models for simple tasks

## Examples and Recipes

### Daily Review
```
Review all notes modified today, summarize key points, and update my daily journal
```

### Knowledge Management
```
Find all notes without tags, analyze their content, and suggest appropriate tags
```

### Content Creation
```
Create a blog post outline based on my notes about [topic], then draft the introduction
```

### Vault Maintenance
```
Find duplicate notes, broken links, and orphaned files, then create a cleanup report
```

### Research Project
```
Search for information about [topic], create structured notes, and link to relevant existing notes
```

## Tips and Tricks

1. **Save Useful Prompts**: Keep a note with prompts that work well
2. **Chain Operations**: Use "then" to connect multiple tasks
3. **Iterate Gradually**: Start simple and add complexity
4. **Use Naming Conventions**: Consistent file names help the agent
5. **Review History**: Learn from past sessions
6. **Set Boundaries**: Use permissions to stay in control
7. **Backup Important Data**: Before major operations
8. **Experiment Safely**: Use a test vault for learning

## Future Possibilities

As agent mode evolves, consider these use cases:
- Automated vault organization
- Intelligent note linking
- Research automation
- Content generation pipelines
- Knowledge graph analysis
- Workflow automation

Remember: The agent is a powerful tool, but you remain in control. Use it to augment your thinking, not replace it.