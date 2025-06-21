# AI-Assisted Writing (Rewrite) Guide

The AI-Assisted Writing feature, also known as "Rewrite," allows Gemini to directly modify your documents during chat conversations. This powerful feature enables collaborative writing where the AI can draft, edit, and refine content based on your instructions.

## Table of Contents

- [Overview](#overview)
- [Safety and Precautions](#safety-and-precautions)
- [Enabling Rewrite](#enabling-rewrite)
- [How Rewrite Works](#how-rewrite-works)
- [Using Rewrite Effectively](#using-rewrite-effectively)
- [The Draft Section](#the-draft-section)
- [Common Use Cases](#common-use-cases)
- [Best Practices](#best-practices)
- [Advanced Techniques](#advanced-techniques)
- [Troubleshooting](#troubleshooting)

## Overview

### What is AI-Assisted Writing?

AI-Assisted Writing allows you to:
- Collaborate with AI to draft documents
- Get the AI to rewrite sections based on feedback
- Iterate on content through conversation
- Maintain a dialogue while the AI updates your document

### Key Features

1. **Direct Document Editing**: AI modifies your note in real-time
2. **Conversational Iteration**: Refine through back-and-forth dialogue
3. **Draft Preservation**: Original content above "# Draft" is protected
4. **Context Awareness**: AI understands your entire document

## Safety and Precautions

### ⚠️ Important Warnings

1. **Backup Your Work**: Always backup important documents before using rewrite
2. **Review Changes**: Carefully review all AI modifications
3. **Use Version Control**: Consider using git or Obsidian's file recovery
4. **Start with Copies**: Practice on duplicate files first

### What Gets Modified

- Only content below the `# Draft` heading is replaced
- Content above `# Draft` is preserved
- If no `# Draft` heading exists, one is created
- The entire draft section is replaced each time

## Enabling Rewrite

### Step 1: Enable in Settings

1. Open Settings → Gemini Scribe
2. Find "Rewrite Files" option
3. Toggle ON
4. Restart may be required

### Step 2: Activate for a Document

1. Open the Gemini Chat
2. Open the document you want to work on
3. Check the "Rewrite file" checkbox in chat interface
4. The AI now has write access to your document

### Visual Indicators

When rewrite is active:
- Checkbox is checked in chat interface
- Chat messages indicate rewrite mode
- AI responses mention document modifications

## How Rewrite Works

### The Process

1. **You write instructions** in the chat
2. **AI generates content** based on your request
3. **Document is updated** with new content
4. **You review and provide feedback**
5. **Iterate** until satisfied

### Technical Details

- AI receives full document context
- Generates complete draft section
- Replaces everything below `# Draft`
- Preserves formatting and structure
- Updates happen after each AI response

## Using Rewrite Effectively

### Starting a New Document

```
You: Help me write a blog post about productivity tips for remote workers

AI: I'll help you create a blog post about productivity tips for remote workers. Let me draft an initial version for you.

[Document is updated with initial draft]

You: Great start! Can you expand the section on time management and add specific techniques?

AI: I'll expand the time management section with specific techniques.

[Document is updated with expanded content]
```

### Editing Existing Content

1. Place existing content below `# Draft` heading
2. Enable rewrite mode
3. Ask for specific changes:
   - "Make this more concise"
   - "Add examples to each point"
   - "Rewrite in a more formal tone"

### Iterative Refinement

Build your document through conversation:

```
You: Start with an outline for a technical guide on Docker

[AI creates outline]

You: Perfect. Now flesh out the introduction section

[AI expands introduction]

You: Add a prerequisites section before the introduction

[AI reorganizes and adds prerequisites]
```

## The Draft Section

### Understanding the Draft Heading

The `# Draft` heading is special:
- Marks the boundary between preserved and rewritable content
- Everything below it is replaced during rewrites
- Everything above it is protected

### Structure Example

```markdown
---
title: My Document
---

# Research Notes
These notes are preserved and won't be modified.

# Draft
Everything below this line can be rewritten by the AI.

[AI-generated content appears here]
```

### Working with Mixed Content

Keep important content above the draft:
- Reference materials
- Personal notes
- Data you don't want changed
- Instructions for yourself

## Common Use Cases

### 1. Blog Post Writing

```
You: Write a blog post about the benefits of meditation. Target audience is busy professionals.

[AI creates initial draft]

You: Add a personal anecdote in the introduction and include scientific studies

[AI revises with anecdote and research]
```

### 2. Documentation

```
You: Create API documentation for a user authentication endpoint

[AI drafts technical documentation]

You: Add code examples in Python and JavaScript

[AI updates with code examples]
```

### 3. Email Drafting

```
You: Help me write a follow-up email after a job interview

[AI creates professional email]

You: Make it slightly less formal and add a question about the timeline

[AI adjusts tone and adds question]
```

### 4. Academic Writing

```
You: Write an introduction for a paper on climate change impacts on agriculture

[AI creates academic introduction]

You: Add more recent citations and strengthen the thesis statement

[AI revises with citations and stronger thesis]
```

### 5. Creative Writing

```
You: Start a short story about a time traveler stuck in medieval times

[AI writes opening]

You: Add more sensory details and develop the character's backstory

[AI enriches the narrative]
```

## Best Practices

### 1. Clear Instructions

**Be Specific**
- ❌ "Make it better"
- ✅ "Add more technical details and include code examples"

**Provide Context**
- ❌ "Write about AI"
- ✅ "Write a beginner-friendly introduction to AI for high school students"

### 2. Iterative Approach

1. Start with structure/outline
2. Expand sections individually
3. Refine tone and style
4. Polish details last

### 3. Preserve Important Content

Keep above `# Draft`:
- Original requirements
- Reference materials
- Personal notes
- Content you want to keep

### 4. Regular Backups

- Use Obsidian's file recovery
- Copy important versions
- Consider git integration
- Export drafts periodically

### 5. Review Thoroughly

After each rewrite:
- Read the entire draft
- Check for accuracy
- Verify tone consistency
- Ensure requirements are met

## Advanced Techniques

### 1. Style Mimicking

Provide examples above the draft:
```markdown
# Style Reference
[Paste example of desired writing style]

# Draft
[AI will mimic the style above]
```

### 2. Structured Templates

Create templates for AI to follow:
```markdown
# Template
- Introduction (2 paragraphs)
- Main Points (3-5 with examples)
- Conclusion (1 paragraph)

# Draft
[AI follows the structure]
```

### 3. Collaborative Outlining

Build complex documents:
1. Create outline together
2. Expand each section individually
3. Ask AI to ensure consistency
4. Refine transitions between sections

### 4. Research Integration

```
You: I've added research notes above. Please write a literature review section that synthesizes these sources.

[AI integrates research into coherent review]
```

### 5. Multi-Format Writing

Same content, different formats:
- "Convert this to a slide presentation outline"
- "Rewrite as a technical specification"
- "Transform into a how-to guide"

## Troubleshooting

### Rewrite Not Working

1. **Check Settings**
   - Ensure "Rewrite Files" is ON
   - Restart Obsidian if needed

2. **Check Chat Interface**
   - "Rewrite file" checkbox must be checked
   - Document must be open

3. **Check Document Structure**
   - Look for `# Draft` heading
   - Ensure proper markdown formatting

### Content Not Updating

**Document not changing:**
- Refresh the document view
- Check if document is in edit mode
- Look for error messages in chat

**Wrong content replaced:**
- Verify `# Draft` heading location
- Check for multiple draft headings
- Ensure heading is exactly `# Draft`

### Quality Issues

**Generic content:**
- Provide more specific instructions
- Include examples or style guides
- Add context above draft section

**Lost information:**
- Move important content above `# Draft`
- Be explicit about what to preserve
- Use incremental changes

### Performance Problems

**Slow updates:**
- Large documents take longer
- Complex requests need processing time
- Consider breaking into sections

**Timeouts:**
- Reduce request complexity
- Work on smaller sections
- Check internet connection

## Safety Tips

### 1. Version Control

Use Obsidian's file recovery:
- Settings → File Recovery
- Configure snapshot interval
- Know how to restore versions

### 2. Backup Strategies

- Duplicate important files first
- Export versions as you work
- Use cloud sync for extra safety
- Consider git for technical documents

### 3. Review Process

1. Read entire draft after each change
2. Compare with previous version
3. Verify facts and figures
4. Check formatting and structure

### 4. Gradual Adoption

- Start with low-stakes documents
- Practice on test files
- Build confidence gradually
- Learn AI's patterns and limitations

## Examples of Effective Use

### Example 1: Technical Blog Post

```
You: I need a blog post explaining containerization to beginners. Start with an analogy.

[AI writes introduction with shipping container analogy]

You: Good! Now add three main benefits with real-world examples.

[AI adds benefits section with examples]

You: Add a simple tutorial section showing how to create a first Docker container.

[AI adds hands-on tutorial]
```

### Example 2: Business Proposal

```
You: Create an outline for a proposal to implement a new CRM system

[AI creates structured outline]

You: Expand the budget section with typical cost ranges

[AI adds detailed budget information]

You: Add a risk assessment section with mitigation strategies

[AI incorporates risk analysis]
```

### Example 3: Academic Essay

```
You: Write an essay introduction about the impact of social media on democracy

[AI writes introduction]

You: Add a thesis statement that takes a nuanced position

[AI revises with clear thesis]

You: Develop three supporting arguments with evidence

[AI expands with structured arguments]
```

## Conclusion

AI-Assisted Writing is a powerful feature that can significantly enhance your writing workflow. By understanding how to use it safely and effectively, you can:

- Draft documents faster
- Iterate on ideas more efficiently
- Maintain consistency in long documents
- Explore different writing styles
- Overcome writer's block

Remember: The AI is a collaborator, not a replacement for your judgment. Always review and refine the output to ensure it meets your standards and requirements.

Start with simple documents, build your confidence, and gradually tackle more complex writing projects. With practice, you'll develop an efficient workflow that combines your creativity and expertise with the AI's capabilities.