# Custom Prompts Guide

The Custom Prompts feature in Gemini Scribe allows you to create reusable AI instruction templates that modify how the AI assistant behaves when working with specific notes. This guide covers everything you need to know about creating and using custom prompts effectively.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Creating Custom Prompts](#creating-custom-prompts)
- [Using Custom Prompts](#using-custom-prompts)
- [Advanced Features](#advanced-features)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Custom prompts are markdown files that contain special instructions for the AI. When you apply a custom prompt to a note, it changes how the AI interacts with that specific note, allowing you to:

- Customize AI behavior for different types of content
- Create specialized assistants for specific tasks
- Maintain consistent AI behavior across similar documents
- Share prompt templates with other users

## Getting Started

### Enable Custom Prompts

1. Open Obsidian Settings
2. Navigate to Gemini Scribe settings
3. Find the "Custom Prompts" section
4. Toggle "Enable Custom Prompts" to ON

### Locate the Prompts Folder

Custom prompts are stored in: `[Your History Folder]/Prompts/`

For example, if your history folder is `gemini-scribe`, prompts will be in `gemini-scribe/Prompts/`.

The plugin automatically creates this folder and adds an example prompt when you first enable the feature.

## Creating Custom Prompts

### Basic Structure

Every custom prompt file has two parts:

1. **Frontmatter** (YAML metadata)
2. **Prompt Content** (instructions for the AI)

### Frontmatter Properties

```yaml
---
name: "Your Prompt Name"              # Required: Display name
description: "What this prompt does"   # Required: Brief description
version: 1                            # Optional: Version number
override_system_prompt: false         # Optional: Replace system prompt entirely
tags: ["category", "use-case"]        # Optional: For organization
---
```

### Example: Technical Documentation Assistant

```markdown
---
name: "Technical Documentation"
description: "Helps write clear, structured technical documentation"
version: 1
override_system_prompt: false
tags: ["documentation", "technical"]
---

You are a technical documentation specialist. When assisting with content:

## Writing Style
- Use clear, concise language
- Define technical terms on first use
- Include code examples where relevant
- Follow consistent formatting

## Structure
- Start with a brief overview
- Use logical heading hierarchy
- Include step-by-step instructions
- Add troubleshooting sections when appropriate

## Code Examples
- Provide working, tested examples
- Include comments explaining complex parts
- Show both basic and advanced usage
- Highlight common pitfalls

Always aim for documentation that is both comprehensive and accessible to readers of varying technical levels.
```

## Using Custom Prompts

### Apply to a Single Note

Add the prompt to your note's frontmatter using a wikilink:

```markdown
---
gemini-scribe-prompt: "[[Technical Documentation]]"
title: "API Reference Guide"
---

# My API Documentation
...
```

### Visual Indicator

When a custom prompt is active, you'll see an indicator in the chat interface:
- Look for "Using prompt: [Prompt Name]" below the chat input
- This confirms the AI is using your custom instructions

### Switching Prompts

To change the prompt for a note:
1. Edit the note's frontmatter
2. Update the `gemini-scribe-prompt` value
3. The change takes effect immediately

To remove a custom prompt:
- Delete the `gemini-scribe-prompt` line from frontmatter
- The AI will revert to default behavior

## Advanced Features

### System Prompt Override

For advanced users who want complete control:

1. Set `override_system_prompt: true` in your prompt file
2. Enable "Allow System Prompt Override" in plugin settings
3. Your prompt will completely replace the default system instructions

**Warning:** Use with caution as this removes built-in safety features and Obsidian-specific knowledge.

### Prompt Templates for Different Use Cases

Create specialized prompts for:

- **Academic Writing**: Citation formatting, scholarly tone
- **Creative Writing**: Character development, narrative flow
- **Code Reviews**: Best practices, security considerations
- **Meeting Notes**: Action items, key decisions
- **Research Notes**: Source evaluation, synthesis

### Organizing Prompts

Use descriptive filenames and tags:
```
Prompts/
├── Writing/
│   ├── Academic Writing.md
│   ├── Creative Writing.md
│   └── Technical Writing.md
├── Coding/
│   ├── Code Review.md
│   └── Documentation.md
└── Research/
    ├── Literature Review.md
    └── Data Analysis.md
```

## Examples

### 1. Creative Writing Assistant

```markdown
---
name: "Creative Writing Coach"
description: "Helps with storytelling, character development, and narrative flow"
version: 1
override_system_prompt: false
tags: ["creative", "writing", "fiction"]
---

You are a creative writing coach specializing in fiction. Focus on:

- **Character Development**: Help create multi-dimensional characters with clear motivations
- **Plot Structure**: Assist with story arcs, pacing, and conflict resolution
- **Descriptive Language**: Suggest vivid imagery and sensory details
- **Dialogue**: Craft natural, character-appropriate conversations
- **Show, Don't Tell**: Convert exposition into engaging scenes

When reviewing text, provide specific suggestions for improvement while preserving the author's unique voice and style.
```

### 2. Code Tutor

```markdown
---
name: "Programming Tutor"
description: "Patient programming teacher who explains concepts clearly"
version: 1
override_system_prompt: false
tags: ["education", "programming", "tutorial"]
---

You are a patient programming tutor. When helping with code:

1. **Explain Concepts First**: Break down the underlying principles
2. **Use Simple Examples**: Start with basic cases before complex ones
3. **Encourage Best Practices**: Mention conventions and standards
4. **Debug Together**: Guide through problem-solving rather than just providing answers
5. **Provide Resources**: Suggest documentation and learning materials

Always use encouraging language and celebrate small victories in the learning process.
```

### 3. Research Assistant

```markdown
---
name: "Research Synthesizer"
description: "Helps analyze and synthesize research materials"
version: 1
override_system_prompt: false
tags: ["research", "academic", "analysis"]
---

You are a research assistant skilled in academic analysis. Your role includes:

## Literature Analysis
- Identify key themes and patterns across sources
- Note methodological approaches and their strengths/limitations
- Highlight gaps in current research

## Synthesis Skills
- Connect ideas from multiple sources
- Create coherent narratives from diverse materials
- Distinguish between correlation and causation

## Critical Evaluation
- Assess source credibility and potential biases
- Compare conflicting findings
- Suggest areas for further investigation

Always maintain academic objectivity and cite sources appropriately.
```

## Best Practices

### 1. Keep Instructions Clear and Specific
- Use bullet points and sections for organization
- Be explicit about desired behaviors
- Include examples when helpful

### 2. Test Your Prompts
- Try the prompt with various types of content
- Refine based on AI responses
- Iterate to improve effectiveness

### 3. Version Control
- Use the `version` field to track changes
- Keep backups of effective prompts
- Document what works well

### 4. Share and Collaborate
- Export prompts as markdown files
- Share with team members
- Build a library of proven prompts

### 5. Balance Specificity and Flexibility
- Too specific: AI becomes rigid
- Too general: No meaningful behavior change
- Find the sweet spot for your use case

## Troubleshooting

### Prompt Not Working

1. **Check the frontmatter syntax**
   - Ensure proper YAML formatting
   - Verify required fields are present

2. **Verify the wikilink**
   - Use exact prompt file name
   - Include double brackets: `[[Prompt Name]]`

3. **Confirm settings**
   - "Enable Custom Prompts" is ON
   - Prompt file exists in correct folder

### AI Behaving Unexpectedly

1. **Review prompt instructions**
   - Look for contradictions
   - Ensure clarity

2. **Check override settings**
   - System prompt override might be removing expected behaviors
   - Try with `override_system_prompt: false`

3. **Test incrementally**
   - Start with simple instructions
   - Add complexity gradually

### Performance Issues

- Very long prompts may slow responses
- Keep prompts focused and concise
- Remove unnecessary instructions

## Tips for Effective Prompts

1. **Start Simple**: Begin with basic instructions and add complexity as needed
2. **Use Examples**: Show the AI what you want with concrete examples
3. **Set Boundaries**: Clearly state what the AI should and shouldn't do
4. **Iterate**: Refine your prompts based on actual usage
5. **Document Success**: Keep notes on what works well

## Conclusion

Custom prompts are a powerful way to tailor Gemini Scribe to your specific needs. By creating thoughtful, well-structured prompts, you can transform the AI into a specialized assistant for any task. Start with the examples provided, experiment with your own ideas, and build a library of prompts that enhance your Obsidian workflow.

Remember: The best prompt is one that consistently produces the results you need. Don't hesitate to experiment and refine until you find what works for you.