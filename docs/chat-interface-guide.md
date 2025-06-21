# Chat Interface Guide

The Chat Interface is the primary way to interact with Gemini AI in Obsidian. This guide covers everything you need to know about using the chat effectively.

## Table of Contents

- [Opening the Chat](#opening-the-chat)
- [Chat Interface Overview](#chat-interface-overview)
- [Context-Aware Conversations](#context-aware-conversations)
- [Chat Features](#chat-features)
- [Working with Responses](#working-with-responses)
- [Search Grounding](#search-grounding)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tips and Best Practices](#tips-and-best-practices)

## Opening the Chat

There are three ways to open the Gemini chat:

1. **Ribbon Icon**: Click the Gemini Scribe icon in the left sidebar
2. **Command Palette**: Press `Ctrl/Cmd + P` and search for "Gemini Scribe: Open Gemini Chat"
3. **Hotkey**: Set a custom hotkey in Settings → Hotkeys → Search for "Open Gemini Chat"

The chat opens as a sidebar panel that can be:
- Docked to either side of your workspace
- Popped out as a separate window
- Minimized when not in use

## Chat Interface Overview

### Main Components

1. **Chat History Area**
   - Displays your conversation with the AI
   - Shows both your messages and AI responses
   - Automatically scrolls to the latest message

2. **Input Area**
   - Text box for typing your messages
   - Supports multi-line input with Shift+Enter
   - Shows character count for long messages

3. **Control Panel**
   - Model indicator (shows which Gemini model is active)
   - Rewrite file checkbox (when enabled in settings)
   - Custom prompt indicator (when using custom prompts)

4. **Send Button**
   - Click to send your message
   - Disabled while AI is responding
   - Shows loading state during processing

## Context-Aware Conversations

### How Context Works

When you send a message, Gemini automatically receives:

1. **Current Note Content**: The full content of your active note
2. **Linked Notes**: Content from notes linked in your current note (based on context depth setting)
3. **Note Metadata**: Title, tags, and frontmatter properties
4. **Conversation History**: Previous messages in the current session

### Configuring Context

In Settings → Gemini Scribe:

- **Send Context**: Toggle whether to include note content
- **Max Context Depth**: Control how many levels of linked notes to include
  - 0 = Only current note
  - 1 = Current note + directly linked notes
  - 2 = Current note + linked notes + notes linked from those
  - 3+ = Deeper traversal (use sparingly for performance)

### Context Best Practices

1. **Start with depth 1**: Usually provides enough context without overwhelming the AI
2. **Increase for research**: Use depth 2-3 when working with interconnected knowledge bases
3. **Disable for general questions**: Turn off context when asking questions unrelated to your notes

## Chat Features

### 1. Conversation Memory

- The AI remembers the entire conversation in the current session
- Reference previous messages naturally: "As we discussed earlier..."
- Context builds throughout the conversation

### 2. Note-Specific Responses

When context is enabled, the AI:
- Understands your note's content and structure
- Can reference specific sections or ideas
- Provides suggestions relevant to your current work

### 3. Multi-Turn Interactions

Build complex discussions:
```
You: Can you help me outline this article?
AI: [Provides outline based on current note]
You: Let's expand section 3 with more detail
AI: [Elaborates on section 3 specifically]
```

### 4. Code Understanding

The AI can:
- Read and understand code blocks in your notes
- Suggest improvements or fixes
- Explain complex code sections
- Generate code examples

## Working with Responses

### Response Features

1. **Copy Button**
   - Each AI response has a copy button
   - Copies the entire response as markdown
   - Preserves formatting and code blocks

2. **Formatting**
   - Responses use full markdown formatting
   - Code blocks include syntax highlighting
   - Lists, headers, and emphasis are preserved

3. **Long Responses**
   - Very long responses are automatically formatted
   - Code blocks can be scrolled horizontally
   - Use the copy button to get the full text

### Continuing Conversations

To build on a response:
1. Reference specific parts: "In your second point about..."
2. Ask for clarification: "Can you explain the third example?"
3. Request modifications: "Can you make that more concise?"

## Search Grounding

### What is Search Grounding?

When enabled, Gemini can search Google to provide:
- Current information beyond its training data
- Fact-checking for important claims
- Additional context from web sources

### Configuring Search Grounding

1. **Enable/Disable**: Toggle in settings
2. **Threshold**: Set sensitivity (0.0 to 1.0)
   - Lower = More likely to search
   - Higher = Only searches when very relevant
   - Default: 0.7

### When Search Grounding Activates

The AI searches when:
- You ask about current events
- You request specific facts or statistics
- The query would benefit from recent information
- The threshold determines how readily it searches

### Understanding Grounded Responses

Grounded responses include:
- Regular AI response
- "Grounding" section with source information
- Links to relevant web pages
- Key facts from search results

## Keyboard Shortcuts

### In the Chat Input

- **Enter**: Send message
- **Shift+Enter**: New line (multi-line message)
- **Ctrl/Cmd+Enter**: Alternative send (useful if Enter is remapped)
- **Escape**: Clear input box

### Navigation

- **Up/Down arrows**: Navigate through your message history
- **Page Up/Down**: Scroll through chat history
- **Home/End**: Jump to beginning/end of conversation

## Tips and Best Practices

### 1. Effective Prompting

**Be Specific**
```
❌ "Help with my note"
✅ "Help me create a summary paragraph for this article about machine learning"
```

**Provide Context**
```
❌ "Fix this"
✅ "This code has a bug where it crashes on empty input. Can you help fix it?"
```

**Ask Follow-ups**
```
"Can you elaborate on point 2?"
"How would this work with my existing structure?"
"Can you provide an example?"
```

### 2. Managing Long Conversations

- Start new chat sessions for different topics
- Use clear topic transitions: "Now, let's discuss..."
- Reference earlier points explicitly
- Copy important responses to your notes

### 3. Working with Code

When discussing code:
1. Include the relevant code in your note
2. Specify the programming language
3. Describe the expected behavior
4. Mention any error messages

### 4. Research and Learning

Use the chat for:
- Exploring concepts mentioned in your notes
- Getting explanations of complex topics
- Finding connections between ideas
- Generating study questions

### 5. Creative Work

The AI can help with:
- Brainstorming ideas based on your notes
- Suggesting alternative phrasings
- Identifying gaps in arguments
- Providing different perspectives

## Common Use Cases

### 1. Note Enhancement
"Based on this note, what key points am I missing?"

### 2. Learning Assistant
"Can you create practice questions from this study material?"

### 3. Writing Helper
"Help me improve the flow between these paragraphs"

### 4. Research Support
"What are the main themes across my linked notes on this topic?"

### 5. Code Review
"Review this function and suggest improvements"

## Troubleshooting

### Chat Not Responding

1. Check your internet connection
2. Verify API key is valid
3. Look for error messages in the chat
4. Try refreshing the chat view

### Slow Responses

- Large context windows take longer
- Complex queries need more processing time
- Consider reducing context depth
- Try a faster model (like Flash)

### Context Not Working

1. Ensure "Send Context" is enabled
2. Check that you have a note open
3. Verify context depth setting
4. Make sure notes are properly linked

### Missing Features

If expected features aren't working:
1. Check plugin settings
2. Ensure you're on the latest version
3. Restart Obsidian if needed
4. Report persistent issues on GitHub

## Advanced Tips

### 1. Chain of Thought

Encourage step-by-step reasoning:
"Let's think through this step-by-step. First..."

### 2. Role Playing

Set a specific role for better responses:
"As a technical editor, review this documentation"

### 3. Structured Output

Request specific formats:
"Provide your response as a numbered list with brief explanations"

### 4. Iterative Refinement

Build complex outputs gradually:
1. Get initial version
2. Request specific improvements
3. Refine until satisfied

Remember: The chat interface is designed to be a natural extension of your note-taking workflow. Experiment with different approaches to find what works best for your needs.