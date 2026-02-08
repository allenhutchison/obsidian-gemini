# Context System Guide

The Context System in Gemini Scribe v4.0+ allows you to provide the AI agent with specific files from your vault as reference material. This guide explains how context works and how to use it effectively.

## Table of Contents

- [Overview](#overview)
- [How Context Works](#how-context-works)
- [Adding Context Files](#adding-context-files)
- [Managing Context](#managing-context)
- [Best Practices](#best-practices)
- [Advanced Usage](#advanced-usage)
- [Troubleshooting](#troubleshooting)

## Overview

### What is Context?

Context in Gemini Scribe refers to files from your vault that the AI agent can access and reference during conversations. Unlike previous versions that automatically traversed linked notes, v4.0+ uses an **explicit, session-based approach** where you manually select which files to include.

### Key Features

- **Session-Based**: Context files persist for the entire session
- **Manual Control**: You choose exactly which files to include
- **@ Mentions**: Quick file selection via @ symbol
- **Tool Integration**: Agent can read additional files on demand
- **AGENTS.md**: Vault-wide context initialization

### Why This Approach?

The new context system provides:

- **Clarity**: You know exactly what the AI can see
- **Performance**: No automatic traversal means faster responses
- **Flexibility**: Add or remove context as needed during conversation
- **Control**: Precise management of what information the AI accesses

## How Context Works

### Context vs. Tool Access

**Context Files** (Always Available):

- Added via @ mentions or file chips
- Automatically included with every message
- Persist throughout the session
- Ideal for reference material you'll use repeatedly

**Tool-Based File Access** (On-Demand):

- Agent uses `read_file` tool when needed
- Not automatically included with messages
- Ideal for files the agent discovers during conversation
- More flexible but requires agent initiative

### AGENTS.md - Vault Context

AGENTS.md is a special file that provides the agent with an overview of your entire vault structure:

**What it contains:**

- Vault folder structure
- File organization patterns
- Key notes and their purposes
- Naming conventions
- Tags and categories in use

**How to create it:**

1. Open Agent Chat
2. Click "Initialize Vault Context" button
3. Agent analyzes your vault and creates AGENTS.md
4. Update periodically as your vault evolves

**Benefits:**

- Agent understands your vault organization
- Better file discovery and suggestions
- More relevant tool usage
- Improved understanding of relationships

## Adding Context Files

### Method 1: @ Mentions (Recommended)

The fastest way to add context files:

1. Type `@` in the chat input
2. A file picker appears
3. Start typing the file name
4. Select from the filtered list
5. File chip appears in input
6. Send message - file is now persistent context

**Example:**

```
User: @Project Plan Can you help me...
[File chip appears for "Project Plan.md"]
[File becomes persistent context for session]
```

### Method 2: File Selection Modal

For adding multiple files at once:

1. Click the file icon in the session header
2. Browse and select files
3. Click "Add to Context"
4. Files appear as chips in the session

### Method 3: Drag and Drop

Drag files from the file explorer directly into the chat.

### What Happens When You Add Context

1. **File is Read**: Content is loaded from your vault
2. **Added to Session**: File persists as context
3. **Included in Messages**: Content sent with every message
4. **Visible Indicator**: File chip shows it's in context
5. **Stays Active**: Remains until you remove it or end session

## Managing Context

### Viewing Current Context

Active context files are displayed:

- As chips in the chat input area
- In the session sidebar (if visible)
- Indicated by visual markers

### Removing Context Files

To remove a file from context:

1. Click the X on the file chip, or
2. Open session settings and remove from context list

### Context Limits

**Technical Limits:**

- Maximum token limit per request (~2M tokens for Gemini 2.5+)
- Large files count against this limit
- Agent may not see all content if limit exceeded

**Practical Recommendations:**

- **1-5 files**: Ideal for most conversations
- **5-10 files**: Works well for research projects
- **10+ files**: May exceed token limits with large files

**File Size Considerations:**

- Small notes (<5KB): Minimal impact
- Medium notes (5-50KB): Good for context
- Large notes (>50KB): Use sparingly
- Very large (>100KB): Consider summarizing first

### Session Persistence

Context files persist:

- ✅ Throughout the current session
- ✅ Across Obsidian restarts
- ✅ When loading saved sessions
- ❌ When creating a new session

To reuse context:

- Load a saved session with existing context
- Or re-add files to new sessions

## Best Practices

### 1. Start Minimal, Expand as Needed

```markdown
❌ Add 20 files immediately
✅ Start with 2-3 most relevant files
✅ Add more if agent needs additional information
```

### 2. Use Relevant, Focused Files

**Good Context:**

- Project overview documents
- Reference materials for current task
- Files with key terminology or concepts
- Documents you'll reference repeatedly

**Poor Context:**

- Random notes not related to conversation
- Very large files (use summaries instead)
- Duplicate information across files
- Rarely-referenced materials

### 3. Leverage AGENTS.md

Before adding lots of context files:

1. Ensure AGENTS.md is current
2. Let agent use tools to discover files
3. Only add files you know you'll reference repeatedly

### 4. Name Files Clearly

The @ mention system works by file name:

- Use descriptive file names
- Avoid generic names like "Notes.md"
- Consider prefixes for organization
- Examples: "Project-Alpha-Overview.md", "Meeting-2024-Q1.md"

### 5. Update Context During Conversation

Context isn't static:

```
User: @Design Doc Let's review the design
[Discuss design]

User: Now I want to implement. Let me add the code structure
      @Code Structure @API Design
[Add new context files as conversation evolves]
```

### 6. Remove Unused Context

If a file is no longer relevant:

- Remove it to save token budget
- Keeps context focused and relevant
- Improves response quality

## Advanced Usage

### Use Case: Research Project

**Setup:**

```
Context Files:
1. Research Question.md - Your main question
2. Literature Review.md - Key papers and findings
3. Methodology.md - Approach and methods
```

**Workflow:**

1. Agent has constant access to research foundation
2. Can compare new findings to literature review
3. Maintains consistency with methodology
4. Add new sources as you discover them

### Use Case: Software Project

**Setup:**

```
Context Files:
1. README.md - Project overview
2. ARCHITECTURE.md - System design
3. API-Spec.md - Interface definitions
```

**Workflow:**

1. Agent understands project structure
2. Suggests code that fits architecture
3. Follows API specifications
4. Can create files in proper locations

### Use Case: Writing Project

**Setup:**

```
Context Files:
1. Character Profiles.md - Main characters
2. World Building.md - Setting details
3. Plot Outline.md - Story structure
```

**Workflow:**

1. Maintains character consistency
2. Adheres to world-building rules
3. Follows plot structure
4. Helps develop scenes in context

### Combining Context with Tools

**Strategic Approach:**

1. **Context Files**: Core reference material
2. **AGENTS.md**: Vault structure understanding
3. **Agent Tools**: Discovery and exploration

**Example:**

```
User: Using our project architecture (in context),
      find all the API endpoints in the codebase
      and create a test plan

Agent:
1. References ARCHITECTURE.md (context)
2. Uses search_files to find endpoints
3. Uses read_file to examine each endpoint
4. Creates test plan following architecture
```

### Session Templates

Create reusable session configurations:

**Technical Writing Session:**

- Context: Style Guide, Glossary, Product Overview
- Model: Gemini 2.5 Pro
- Custom Prompt: Technical writing assistant

**Creative Writing Session:**

- Context: Character profiles, world building
- Model: Gemini 3 Pro (if available)
- Custom Prompt: Creative writing coach

**Research Session:**

- Context: Research questions, literature review
- Model: Gemini 2.5 Pro
- Custom Prompt: Research assistant

## Troubleshooting

### Context Not Working

**Issue**: Added file but agent doesn't reference it

**Checks:**

1. Verify file chip is visible in chat
2. Confirm file exists in vault
3. Check file isn't corrupted
4. Try re-adding the file
5. Start a new message

**Fix**: Remove and re-add the file, or create new session

### File Not Found in @ Mentions

**Issue**: Can't find file when using @

**Reasons:**

1. File name typed incorrectly
2. File is in excluded folder
3. File doesn't exist
4. Typo in search

**Fix**:

- Check file name spelling
- Use file explorer to verify file exists
- Try partial name matching
- Check folder isn't excluded in settings

### Token Limit Exceeded

**Issue**: Error about request being too large

**Causes:**

- Too many context files
- Files are very large
- Long conversation history

**Solutions:**

1. Remove some context files
2. Create a new session (clears history)
3. Use summaries instead of full files
4. Split conversation into focused sessions

### Agent Ignoring Context

**Issue**: Agent doesn't use context files even though they're added

**Reasons:**

1. Files aren't relevant to question
2. Agent has sufficient knowledge without them
3. Files are very long (truncated in context)
4. Conversation history dominates attention

**Solutions:**

1. Explicitly reference context: "Based on the Design Doc..."
2. Ask specific questions about context content
3. Reduce conversation history by starting new session
4. Verify context files contain relevant information

### Performance Issues

**Issue**: Slow responses with context files

**Causes:**

- Too many or too large files
- Token limit approaching
- Network latency

**Optimizations:**

1. Reduce number of context files
2. Use smaller, focused files
3. Remove unnecessary context
4. Consider using Pro model (larger context window)

## Migration from v3.x

If you're upgrading from v3.x, the context system changed significantly:

**Old System (v3.x):**

- Automatic link traversal
- "Send Context" toggle
- "Max Context Depth" setting
- Followed [[links]] automatically

**New System (v4.0+):**

- Manual file selection
- No automatic traversal
- @ mentions for adding files
- Agent tools for file discovery

**Why the Change:**

- More control and transparency
- Better performance
- Clearer behavior
- More flexible for different use cases

**Adaptation Tips:**

1. Identify files you used to rely on automatic inclusion
2. Add those explicitly as context
3. Use AGENTS.md for vault awareness
4. Let agent use tools for discovery

## Summary

The v4.0+ context system gives you precise control over what the AI agent can see:

**Key Takeaways:**

- Context is **explicit and session-based**
- Add files with **@ mentions**
- Start with **2-3 focused files**
- Let agent **use tools** for additional files
- Use **AGENTS.md** for vault awareness
- **Remove unused** context to stay efficient

**Remember:**

- Quality over quantity for context files
- AGENTS.md provides vault-wide understanding
- Agent tools can read files on-demand
- Session-based approach gives you full control

For more information, see:

- [Agent Mode Guide](/guide/agent-mode) - Tool usage and capabilities
- [Settings Reference](/reference/settings) - Configuration options
- [Custom Prompts Guide](/guide/custom-prompts) - Behavior customization
