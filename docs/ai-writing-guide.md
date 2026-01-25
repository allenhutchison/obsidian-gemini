# Selection-Based AI Features Guide

This guide covers all selection-based AI features in Gemini Scribe, allowing you to work with selected text in powerful ways.

## Table of Contents

- [Overview](#overview)
- [Text Rewriting](#text-rewriting)
  - [Getting Started](#getting-started)
  - [How It Works](#how-it-works)
  - [Writing Effective Instructions](#writing-effective-instructions)
  - [Common Use Cases](#common-use-cases)
- [Explain Selection](#explain-selection)
  - [How to Use](#how-to-use-explain)
  - [Default Prompts](#default-prompts)
  - [Creating Custom Prompts](#creating-custom-explain-prompts)
- [Ask about Selection](#ask-about-selection)
  - [How to Use](#how-to-use-ask)
  - [Example Questions](#example-questions)
- [Best Practices](#best-practices)
- [Advanced Techniques](#advanced-techniques)
- [Tips and Tricks](#tips-and-tricks)

---

## Overview

Gemini Scribe provides three powerful ways to work with selected text:

| Feature     | Purpose                              | Output                         |
| ----------- | ------------------------------------ | ------------------------------ |
| **Rewrite** | Transform and improve selected text  | Replaces selection in document |
| **Explain** | Get AI explanations of selected text | Modal with insert/copy options |
| **Ask**     | Ask questions about selected text    | Modal with insert/copy options |

All features are accessible via:

- **Right-click context menu** when text is selected
- **Command palette** (Ctrl/Cmd + P)
- **Keyboard shortcuts** (configurable in Obsidian settings)

---

# Text Rewriting

### What is Selection-Based Text Rewriting?

Selection-Based Text Rewriting allows you to:

- **Select any text** in your document for AI improvement
- **Provide specific instructions** for how to rewrite it
- **Maintain document flow** with context-aware improvements
- **Work safely** without risk of modifying unintended content

### Key Benefits

1. **🎯 Precise Control**: Only the selected text is modified
2. **🔒 Safe Operation**: No risk of accidentally changing your entire document
3. **🧠 Context-Aware**: AI considers surrounding content and linked documents
4. **⚡ Quick Access**: Right-click menu or command palette integration
5. **🎨 Flexible Instructions**: Natural language instructions for any type of improvement

## Getting Started

### Prerequisites

- Gemini Scribe plugin installed and configured
- Valid Gemini API key
- An open Markdown document

### Basic Workflow

1. **Select text** you want to improve
2. **Right-click** and choose "Rewrite with Gemini" (or use command palette)
3. **Enter instructions** in the modal dialog
4. **Review** the rewritten text
5. **Accept** the changes automatically applied to your selection

## How It Works

### The Rewrite Process

1. **Text Selection**: You highlight the specific text that needs improvement
2. **Context Building**: The AI receives:
   - Your selected text
   - The full document with selection markers
   - Linked documents (based on your context settings)
   - Your rewrite instructions
3. **AI Processing**: The AI rewrites only the selected portion while considering:
   - Document style and tone
   - Surrounding context
   - Overall document structure
   - Your specific instructions
4. **Text Replacement**: The original selection is replaced with the improved version

### Context Awareness

The AI has access to:

- **Full document content** to understand context and maintain consistency
- **Linked documents** from your vault (if context sending is enabled)
- **Selection markers** showing exactly what to rewrite
- **Document structure** to maintain appropriate flow

## Writing Effective Instructions

### Clear and Specific Instructions

**Good Examples:**

```
"Make this more concise while keeping the key points"
"Fix grammar and improve sentence flow"
"Make this sound more professional and formal"
"Expand this with more specific examples"
"Simplify this for a general audience"
"Make this more technical and add industry terminology"
```

**Avoid Vague Instructions:**

```
"Make it better" (too vague)
"Change this" (no direction)
"Fix it" (unclear what needs fixing)
```

### Instruction Categories

#### **Style Adjustments**

- "Make this more formal/casual"
- "Adjust the tone to be more friendly"
- "Make this sound more confident"
- "Write in a more conversational style"

#### **Structure Improvements**

- "Break this into shorter sentences"
- "Combine these ideas into one paragraph"
- "Add better transitions between ideas"
- "Reorganize for better logical flow"

#### **Content Enhancement**

- "Add more specific examples"
- "Include relevant statistics or data"
- "Expand with more detail"
- "Add a compelling introduction"

#### **Clarity and Concision**

- "Make this more concise without losing meaning"
- "Simplify the language for beginners"
- "Clarify the main argument"
- "Remove redundant information"

#### **Technical Adjustments**

- "Fix grammar and spelling errors"
- "Improve sentence structure"
- "Correct any factual inaccuracies"
- "Format this as a bulleted list"

## Common Use Cases

### 📝 Content Improvement

**Scenario**: Rough draft paragraph needs polishing

```
Selected text: "The thing about productivity is its hard to measure and people have different ideas about what it means."

Instruction: "Fix grammar and make this more polished and clear"

Result: "Productivity is challenging to measure because people have varying definitions of what it means to be productive."
```

### 📊 Technical Writing

**Scenario**: Making complex content accessible

```
Instruction: "Simplify this technical explanation for a general audience"
```

### ✍️ Creative Writing

**Scenario**: Enhancing narrative descriptions

```
Instruction: "Make this description more vivid and engaging"
```

### 📧 Professional Communication

**Scenario**: Adjusting tone for business context

```
Instruction: "Make this more professional while keeping it friendly"
```

### 🔍 Research Notes

**Scenario**: Organizing scattered thoughts

```
Instruction: "Organize these ideas into a logical sequence with better transitions"
```

---

# Explain Selection

The Explain Selection feature lets you get AI-powered explanations of any selected text. Perfect for understanding complex content, code, or unfamiliar concepts.

## How to Use Explain {#how-to-use-explain}

1. **Select text** in your document
2. **Right-click** and choose "Explain Selection"
3. **Pick a prompt** from the selection modal (prompts tagged with `selection-action`)
4. **View the response** in a modal window
5. **Choose an action**:
   - **Insert as Callout**: Adds the explanation as a callout block after your selection
   - **Copy**: Copies the explanation to clipboard
   - **Close**: Dismiss the modal

### Keyboard Shortcut

You can assign a keyboard shortcut to "Explain selection with AI" in Obsidian's Hotkeys settings.

## Default Prompts

When you first use Explain Selection, three default prompts are created in your Prompts folder:

| Prompt                  | Description                     | Best For           |
| ----------------------- | ------------------------------- | ------------------ |
| **Explain Selection**   | General explanation of the text | Most content types |
| **Explain Code**        | Detailed code walkthrough       | Programming code   |
| **Summarize Selection** | Concise summary                 | Long passages      |

## Creating Custom Explain Prompts {#creating-custom-explain-prompts}

Create your own prompts for specific use cases by adding files to your Prompts folder with the `selection-action` tag:

```markdown
---
name: 'Explain for Beginners'
description: 'Explain in simple terms for beginners'
version: 1
override_system_prompt: false
tags: ['selection-action', 'explain', 'beginner']
---

Please explain the following text in very simple terms:

- Use everyday language, avoid jargon
- Provide real-world analogies where helpful
- Break down complex ideas into small steps
- Assume the reader has no prior knowledge
```

### Example Custom Prompts

**Technical Deep Dive**

```markdown
## tags: ["selection-action", "technical"]

Provide a deep technical analysis of this content:

- Explain underlying concepts and mechanisms
- Discuss edge cases and limitations
- Suggest related topics to explore
```

**Study Helper**

```markdown
## tags: ["selection-action", "study"]

Help me study this content:

- Identify key concepts to remember
- Create potential exam questions
- Suggest memory aids or mnemonics
```

---

# Ask about Selection

The Ask about Selection feature lets you ask any question about selected text. The AI will analyze the selection and answer your specific question.

## How to Use Ask {#how-to-use-ask}

1. **Select text** in your document
2. **Right-click** and choose "Ask about Selection"
3. **Type your question** in the modal
4. **Press Enter** or click "Ask"
5. **View the response** and choose an action:
   - **Insert as Callout**: Adds the Q&A as a callout block
   - **Copy**: Copies the response to clipboard
   - **Close**: Dismiss the modal

### Keyboard Shortcut

You can assign a keyboard shortcut to "Ask about selection" in Obsidian's Hotkeys settings.

## Example Questions

### For Code

- "What does this function return?"
- "Are there any bugs in this code?"
- "How could I optimize this?"
- "What design pattern is being used here?"

### For Text

- "What is the main argument?"
- "Is this statement accurate?"
- "What are the key takeaways?"
- "How does this relate to [topic]?"

### For Data

- "What trends do you see in this data?"
- "Are there any outliers?"
- "What conclusions can be drawn?"

### For Research

- "What methodology is being used?"
- "What are the limitations of this study?"
- "How does this compare to other research?"

---

## Best Practices

### Before Rewriting

1. **Read the full context** to understand how your selection fits
2. **Be specific** about what you want to improve
3. **Consider your audience** when writing instructions
4. **Start with small selections** to get familiar with the feature

### Writing Instructions

1. **Be specific and actionable**: Instead of "make it better", say "make it more concise"
2. **Include target audience**: "Simplify for beginners" vs "Make more technical"
3. **Specify desired outcome**: "Turn into a bulleted list" or "Add more examples"
4. **Consider context**: Reference the document type or purpose if relevant

### After Rewriting

1. **Review carefully** to ensure the rewrite meets your expectations
2. **Check consistency** with the surrounding text
3. **Verify accuracy** of any facts or claims
4. **Test the flow** by reading the full paragraph/section

## Advanced Techniques

### Multi-Step Rewriting

For complex improvements, use multiple rewrite sessions:

1. **First pass**: "Fix grammar and basic clarity issues"
2. **Second pass**: "Make this more engaging and add examples"
3. **Third pass**: "Adjust tone to be more professional"

### Context-Specific Instructions

Reference other parts of your document:

```
"Make this introduction match the formal tone used in the conclusion"
"Adjust this to be consistent with the writing style in the previous section"
"Make this flow better from the preceding paragraph"
```

### Template-Style Instructions

Create reusable instruction patterns:

```
"Convert to FAQ format with questions and answers"
"Rewrite as a step-by-step tutorial"
"Transform into a comparison table format"
"Change to executive summary style"
```

### Collaborative Iteration

Use the chat feature alongside selection rewriting:

1. **Ask questions** in chat about what would work best
2. **Get suggestions** for improvement approaches
3. **Use chat feedback** to refine your rewrite instructions

## Tips and Tricks

### Keyboard Shortcuts

- Use **Command Palette** (Ctrl/Cmd + P) and type "Rewrite selected text" for quick access
- The modal supports **Ctrl/Cmd + Enter** to submit quickly

### Selection Strategies

- **Start small**: Begin with single sentences or short paragraphs
- **Natural boundaries**: Select complete thoughts or logical sections
- **Avoid partial sentences**: Unless specifically reformatting structure

### Instruction Refinement

- **Iterate**: If the first result isn't perfect, select again and provide more specific guidance
- **Combine goals**: "Fix grammar and make more concise" works well together
- **Reference style**: "Make this match the tone of academic papers" or "Write like a blog post"

### Quality Control

- **Read aloud**: Check if the rewritten text flows naturally
- **Check links**: Ensure any internal links or references still make sense
- **Verify formatting**: Make sure markdown formatting is preserved appropriately

### Working with Large Documents

- **Section by section**: Rewrite large documents in manageable chunks
- **Maintain consistency**: Use similar instructions for related sections
- **Review transitions**: Pay attention to how rewritten sections connect

## Troubleshooting

### Common Issues

**Issue**: Rewrite doesn't match expectations
**Solution**: Provide more specific instructions and context about desired outcome

**Issue**: Style doesn't match rest of document
**Solution**: Include references to document style in your instructions

**Issue**: Important information was removed
**Solution**: Specify what information must be preserved in your instructions

**Issue**: Result is too different from original
**Solution**: Use more conservative instructions like "lightly edit for clarity"

### Getting Better Results

1. **Provide context**: Mention the document type, audience, or purpose
2. **Be specific**: Replace vague terms with concrete requirements
3. **Use examples**: Reference other parts of your document as style guides
4. **Iterate**: Refine instructions based on previous results

Remember: The Selection-Based Text Rewriting feature is designed to be your collaborative writing partner, helping you refine and improve your content with precision and control.
