# Selection-Based Text Rewriting Guide

The Selection-Based Text Rewriting feature allows you to precisely improve any portion of your text with AI assistance. Unlike traditional full-document rewriting, this feature provides surgical precision for refining specific sections while maintaining consistency with your overall document.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [How It Works](#how-it-works)
- [Writing Effective Instructions](#writing-effective-instructions)
- [Common Use Cases](#common-use-cases)
- [Best Practices](#best-practices)
- [Advanced Techniques](#advanced-techniques)
- [Tips and Tricks](#tips-and-tricks)

## Overview

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