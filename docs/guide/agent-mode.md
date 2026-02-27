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

When the agent needs to perform these operations, an **in-chat confirmation request** appears with interactive buttons. You can also use "Don't ask again this session" for trusted workflows. See [Tool Confirmations](#tool-confirmations) for details.

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

### File Attachments & Drag-and-Drop

You can include images, audio, video, PDFs, and text files in your chat. Files are automatically classified and routed:

**Adding Files:**

- **Paste** images directly from your clipboard (Ctrl/Cmd+V)
- **Drag and drop** files from your vault's file explorer into the input box
- **Drag and drop** files from your OS file manager (if they're inside the vault)
- **Drag and drop** folders to include all contained files
- Multiple files can be attached to a single message

**How Files Are Routed:**

When you drop a file, the plugin classifies it based on its extension:

| Category                      | Extensions                                                                    | Action                                                             |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Text**                      | `.md`, `.txt`, `.ts`, `.js`, `.json`, `.html`, `.css`, `.py`, etc.            | Added as context chips (the AI reads the file content)             |
| **Binary (Gemini-supported)** | `.png`, `.jpg`, `.gif`, `.webp`, `.pdf`, `.mp3`, `.wav`, `.mp4`, `.mov`, etc. | Sent as inline data (the AI processes the binary content directly) |
| **Unsupported**               | `.zip`, `.exe`, `.dmg`, etc.                                                  | Skipped with a notification                                        |

**Supported Binary Formats:**

- **Images**: PNG, JPEG, GIF, WebP, HEIC, HEIF
- **Audio**: WAV, MP3, AAC, FLAC
- **Video**: MP4, MPEG, MOV, FLV, MPG, WebM, WMV, 3GP
- **Documents**: PDF

**How It Works:**

1. When you add a binary file, a preview appears above the input (thumbnail for images, icon + filename for other types)
2. Click the × button on any preview to remove it before sending
3. Pasted/external images are saved to your vault's attachment folder; vault files are referenced in place
4. The AI receives both the file content and its vault path for referencing
5. Images appear in the chat as wikilink embeds (e.g., `![[attachments/pasted-image.png]]`); non-image attachments (PDF, audio, video) are listed by vault path and type label

**Size Limits:**

- Cumulative inline data is limited to **20 MB** per message
- Files exceeding the limit are skipped with a notification

> **Privacy Note**: Attached files are sent to the Gemini API for analysis. Avoid attaching files containing sensitive, confidential, or personal information.

**Usage Examples:**

```text
User: [pastes screenshot] What's wrong with this error message?

Agent: I can see a TypeScript error in your screenshot. The issue is...
```

```text
User: [drops a PDF] Summarize the key points from this document

Agent: Based on the PDF, here are the main points...
```

```text
User: [drops a folder with mixed files] Review these project files

Agent: I can see the markdown notes in context and the attached images...
```

**Combining with Context Files:**

Attachments work alongside @ mentions and context files. You can:

- Reference attached files in context: "Look at the screenshot and update @ProjectNotes with the solution"
- Ask the agent to embed images in notes it creates
- Use file paths in wikilinks: `![[path/to/image.png]]`

**Edge Cases:**

- Large files are sent as-is (no automatic compression)
- Unsupported file types are skipped with a notification
- If file processing fails, you'll see a notification
- Dropping a folder recursively includes all child files

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

Search for files by name pattern (searches filenames/paths only):

```
Find all files containing "project"
Search for "*.md" files in the Projects folder
```

#### search_file_contents

Search for text within file contents (grep-style search):

```
Find all notes mentioning "machine learning"
Search for TODO items across my vault
Find files containing the phrase "quarterly review" (case-insensitive)
Search using regex pattern: "deadline.*2024"
```

Supports:

- Case-sensitive and case-insensitive search
- Regex patterns
- Context lines before/after matches
- Respects system folder exclusions

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

### Skill Tools

Gemini Scribe supports an extensible skills system based on the [agentskills.io](https://agentskills.io) specification. Skills are self-contained packages of instructions that give the agent specialized knowledge and workflows.

#### How Skills Work

Skills are stored in your plugin state folder at `gemini-scribe/skills/`. Each skill is a directory containing a `SKILL.md` file with instructions the agent can load on demand. The agent automatically knows which skills are available — their names and descriptions are included in every agent session.

When the agent encounters a task that matches an available skill, it will activate the skill to load its full instructions before proceeding.

#### activate_skill

Load a skill's full instructions or resources:

```
Activate the code-review skill and review my latest note
Use the meeting-notes skill to process my meeting notes
```

You can also ask the agent to load specific resources from a skill:

```
Load the reference docs from the code-review skill
```

#### create_skill

Create new skills from your conversations:

```
Create a skill called "daily-review" that helps me review and organize my daily notes
```

The agent will create a properly formatted `SKILL.md` file with the name, description, and instructions you provide. Skills you create will be available in all future sessions.

#### SKILL.md Format

Each skill follows a simple format — YAML frontmatter with a name and description, followed by markdown instructions:

```yaml
---
name: my-skill
description: >-
  Description of what this skill does and when to use it.
---
# My Skill

Step-by-step instructions for the agent...
```

Skills can also include optional subdirectories:

- `references/` — Detailed reference documents
- `assets/` — Templates, data files
- `scripts/` — Reference scripts (read-only in Obsidian)

#### Discovering Available Skills

The agent automatically knows which skills are installed. Simply ask:

```
What skills do you have available?
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

## Tool Confirmations

When the agent needs to perform operations that require your approval (like creating, modifying, or deleting files), an **in-chat confirmation request** appears directly in the conversation.

### How Confirmations Work

Instead of popup modals, confirmation requests appear as interactive messages in the chat:

```text
🔒 Permission Required

📝 Write File
Vault Operation • Requires Confirmation

Create or update a file in the vault

Parameters:
• path: "notes/Meeting-Summary.md"
• content: "# Meeting Summary..." (1,234 chars)

[✓ Allow] [✗ Cancel] [☑ Don't ask again this session]
```

### Confirmation Actions

**✓ Allow** - Approve this operation

- The agent proceeds with the operation
- Confirmation message updates to show approval
- The agent continues with subsequent steps

**✗ Cancel** - Decline this operation

- The agent cancels the operation
- Confirmation message updates to show cancellation
- The agent may explain why it cannot continue or suggest alternatives

**☑ Don't ask again this session** - Create session-level permission

- Check this box before clicking Allow
- The agent won't request confirmation for this tool again during the current session
- Useful for repetitive operations you trust
- **Important**: Permission resets when you create a new session or restart Obsidian

### After You Respond

Once you click a button, the confirmation request updates to show the result:

```text
✓ Permission granted: Write File was allowed
```

or

```text
✗ Permission denied: Write File was cancelled
```

### What Operations Require Confirmation

By default, these operations require confirmation:

- **write_file**: Creating or modifying files
- **delete_file**: Removing files
- **move_file**: Moving or renaming files

You can configure which operations require confirmation in **Settings → Gemini Scribe → Agent Permissions**.

### Session-Level Permissions

When you check "Don't ask again this session" and click Allow:

1. The permission is remembered for the current session only
2. Future uses of that tool won't prompt for confirmation
3. Other tool types still require confirmation (unless you've also allowed them)
4. The permission is **cleared** when you:
   - Create a new session
   - Load a different session
   - Restart Obsidian

**Use case example:**

```text
User: Organize my daily notes into monthly folders

[Agent requests permission to move first file]
🔒 Permission Required - Move File
[You check "Don't ask again this session" and click Allow]

[Agent proceeds to move all remaining files without additional prompts]
```

### Reviewing Confirmation Details

Before clicking Allow, always review:

1. **Tool Name**: What operation the agent wants to perform
2. **Parameters**: File paths, content snippets, and other details to verify
3. **File Paths**: Ensure paths are correct and won't overwrite important files
4. **Content Preview**: Check the content looks reasonable (for write operations)
   **Example - Be careful with destructive operations:**

```text
🔒 Permission Required

🗑️ Delete File
Vault Operation • Requires Confirmation

Delete a file from the vault

Parameters:
• path: "important-research.md"  ⚠️ Double-check this path!

[✓ Allow] [✗ Cancel] [☑ Don't ask again this session]
```

### Best Practices for Confirmations

1. **Start Cautious**: Don't use "Don't ask again" until you trust the agent's behavior for your specific task
2. **Review File Paths**: Always check paths before allowing file operations
3. **Read-Only First**: Test with read-only operations before allowing writes
4. **Backup Important Data**: Have backups before bulk operations
5. **Cancel and Clarify**: If unsure, click Cancel and ask the agent to explain what it's trying to do
6. **Session Scope**: Remember that "Don't ask again" only applies to the current session

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

When in-chat confirmation requests appear:

- Read the tool name and operation type
- Review all parameters (especially file paths)
- Check content previews for write operations
- Ensure you have backups for destructive operations
- See the [Tool Confirmations](#tool-confirmations) section for detailed guidance

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

- In-chat confirmation requests for vault operations (create, modify, delete, move)
- Interactive buttons to Allow or Cancel each operation
- Review tool details and parameters before approving
- "Don't ask again this session" option for repetitive trusted operations
- Session-level permissions reset when session ends
- See [Tool Confirmations](#tool-confirmations) for complete workflow details

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

## Further Reading

- [What I Did On My Summer Vacation](https://allen.hutchison.org/2025/09/24/what-i-did-on-my-summer-vacation/) — The story behind Agent Mode's development
- [Everything Becomes an Agent](https://allen.hutchison.org/2026/01/15/everything-becomes-an-agent/) — How every AI project evolves into an agent, and the patterns behind tools, memory, and autonomy
