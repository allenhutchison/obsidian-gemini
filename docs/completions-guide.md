# IDE-Style Completions Guide

IDE-Style Completions bring intelligent, context-aware text suggestions to your Obsidian writing experience. Like code completion in programming IDEs, this feature predicts and suggests what you might want to write next.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [How Completions Work](#how-completions-work)
- [Using Completions](#using-completions)
- [Configuration](#configuration)
- [Writing Effectively with Completions](#writing-effectively-with-completions)
- [Advanced Features](#advanced-features)
- [Tips and Tricks](#tips-and-tricks)
- [Troubleshooting](#troubleshooting)

## Overview

### What are IDE-Style Completions?

Completions provide:
- Real-time text suggestions as you type
- Context-aware predictions based on surrounding content
- Single-keypress acceptance (Tab)
- Seamless integration with your writing flow

### Benefits

1. **Faster Writing**: Complete sentences and paragraphs quickly
2. **Consistency**: Maintain style and terminology
3. **Idea Generation**: Get suggestions for what to write next
4. **Reduced Typing**: Especially helpful for repetitive content
5. **Learning Tool**: See how AI would continue your thoughts

## Getting Started

### Enable Completions

1. Open Command Palette (`Ctrl/Cmd + P`)
2. Search for "Gemini Scribe: Toggle Completions"
3. Press Enter
4. See confirmation notice: "Completions enabled" or "Completions disabled"

### Quick Test

1. Open any markdown note
2. Type a few words and pause
3. After ~750ms, a gray suggestion appears
4. Press `Tab` to accept or any other key to dismiss

## How Completions Work

### The Completion Process

1. **You type** in your note
2. **Pause detected** (750ms without typing)
3. **Context gathered** from surrounding text
4. **AI generates** a suggestion
5. **Suggestion appears** in gray text
6. **You choose** to accept or continue typing

### Context Understanding

The AI considers:
- Previous paragraphs
- Current sentence
- Document structure
- Markdown formatting
- Your writing style

### Smart Predictions

Completions understand:
- **Lists**: Continues numbered or bulleted lists
- **Headers**: Suggests appropriate content
- **Code blocks**: Language-aware suggestions
- **Links**: Completes wiki-links and markdown links
- **Tables**: Helps with table formatting

## Using Completions

### Basic Usage

1. **Start typing** normally
2. **Pause briefly** when you want a suggestion
3. **Review suggestion** (appears in gray)
4. **Accept or dismiss**:
   - `Tab`: Accept the suggestion
   - Any other key: Dismiss and continue

### Accepting Completions

**Full acceptance**: Press `Tab` once
- Entire suggestion is inserted
- Cursor moves to end
- Continue typing normally

**Dismissing**: Press any other key
- Suggestion disappears
- Your keypress is processed normally
- No text is inserted

### When Completions Appear

Suggestions trigger when:
- You pause mid-sentence
- After punctuation (. ! ?)
- At the start of new lines
- After list markers (-, *, 1.)
- Inside markdown structures

## Configuration

### Settings

In Settings → Gemini Scribe:

**Completion Model**
- Gemini 1.5 Flash-8B (fastest, recommended)
- Gemini 1.5 Flash (balanced)
- Gemini 1.5 Pro (highest quality, slower)

### Model Comparison

| Model | Speed | Quality | Best For |
|-------|-------|---------|----------|
| Flash-8B | ~500ms | Good | Most writing, note-taking |
| Flash | ~750ms | Better | Important documents |
| Pro | ~2s | Best | Critical content |

### Performance Tuning

Completions are optimized for:
- 750ms debounce (prevents excessive API calls)
- Smart context extraction
- Efficient caching
- Minimal UI disruption

## Writing Effectively with Completions

### 1. Note-Taking

**Meeting Notes**
```
Type: "Action items from today's meeting:"
Pause...
Suggestion: "1. Review Q3 budget projections"
Tab to accept, continue with your items
```

**Daily Notes**
```
Type: "Today I learned"
Pause...
Suggestion: "about the importance of consistent documentation practices"
```

### 2. Technical Writing

**Documentation**
```
Type: "To install the package, run"
Pause...
Suggestion: "`npm install package-name`"
```

**Code Comments**
```
Type: "This function"
Pause...
Suggestion: "handles user authentication and returns a JWT token"
```

### 3. Creative Writing

**Story Continuation**
```
Type: "The old lighthouse keeper"
Pause...
Suggestion: "watched the storm clouds gather on the horizon"
```

**Descriptions**
```
Type: "The room was"
Pause...
Suggestion: "dimly lit by a single candle flickering in the corner"
```

### 4. Academic Writing

**Research Notes**
```
Type: "The study demonstrates that"
Pause...
Suggestion: "increased exposure to natural light improves cognitive performance"
```

**Citations**
```
Type: "According to Smith (2023),"
Pause...
Suggestion: "the correlation between these variables is statistically significant"
```

## Advanced Features

### 1. List Completion

Start a list and let AI continue:
```
1. First step
2. [pause]
   AI suggests: "Second step in the process"
```

### 2. Markdown Formatting

**Bold/Italic**
```
Type: "This is **important"
Pause...
Suggestion: "** because it affects all users"
```

**Links**
```
Type: "See [[Project"
Pause...
Suggestion: " Notes]] for more details"
```

### 3. Table Assistance

```
| Column 1 | Column 2 |
|----------|----------|
| Data     | [pause]
Suggestion: "More Data |"
```

### 4. Code Block Completion

````
```python
def calculate_
[pause]
Suggestion: "average(numbers):"
````

### 5. Template Expansion

Create shortcuts:
```
Type: "mtg"
Pause...
Suggestion: "Meeting Notes - [Date]"
```

## Tips and Tricks

### 1. Completion Patterns

**Sentence Starters**
- "The main advantage is"
- "In conclusion,"
- "For example,"
- "This means that"

**Transition Phrases**
- "Furthermore,"
- "On the other hand,"
- "As a result,"

### 2. Speed Techniques

**Partial Acceptance**
- Type the beginning
- Let AI complete
- Edit if needed

**Rapid Documentation**
- Start sections
- Accept completions
- Refine later

### 3. Learning from Suggestions

Observe how AI:
- Structures sentences
- Uses transitions
- Maintains consistency
- Formats markdown

### 4. Custom Patterns

Train the AI by:
- Using consistent formats
- Repeating structures
- Building templates

### 5. Efficient Workflows

**Outlining**
1. Type main points
2. Let AI expand
3. Reorganize as needed

**Brainstorming**
1. Start ideas
2. See AI suggestions
3. Build on interesting ones

## Troubleshooting

### Completions Not Appearing

1. **Check if enabled**
   - Run toggle command
   - Look for confirmation

2. **Verify file type**
   - Must be markdown (.md)
   - Not in code blocks

3. **Check timing**
   - Wait full 750ms
   - Don't type too quickly

4. **API issues**
   - Verify API key
   - Check internet connection

### Poor Quality Suggestions

**Too generic**
- Provide more context
- Write clearer beginnings
- Use specific terminology

**Wrong style**
- Be consistent in document
- Use clear formatting
- Maintain tone

**Irrelevant**
- Check document structure
- Ensure logical flow
- Provide better context

### Performance Issues

**Slow suggestions**
- Switch to Flash-8B model
- Check network speed
- Reduce document size

**Disrupting flow**
- Type without pausing
- Disable for focused writing
- Adjust mental timing

### Conflicts

**With other plugins**
- Disable conflicting completions
- Check for keybinding conflicts
- Report compatibility issues

**With templates**
- Completions work alongside templates
- May suggest template syntax
- Edit suggestions as needed

## Best Practices

### 1. Context is Key

Write clear beginnings:
- ❌ "The thing is"
- ✅ "The main challenge with this approach is"

### 2. Pause Strategically

Pause when you:
- Need the next idea
- Want formatting help
- Seek specific information
- Feel stuck

### 3. Edit and Refine

Completions are suggestions:
- Review before accepting
- Edit after accepting
- Don't accept blindly
- Maintain your voice

### 4. Use for First Drafts

Completions excel at:
- Getting ideas flowing
- Overcoming blank pages
- Rapid prototyping
- Rough drafts

### 5. Disable When Needed

Turn off for:
- Final editing
- Precise writing
- Personal journaling
- Sensitive content

## Common Patterns

### Email Templates
```
"Thank you for" → "your email regarding..."
"I hope this" → "message finds you well"
"Please let me know" → "if you have any questions"
```

### Technical Documentation
```
"To configure" → "the settings, follow these steps:"
"The API returns" → "a JSON response containing..."
"Error handling" → "is implemented using try-catch blocks"
```

### Academic Writing
```
"This research" → "contributes to the existing literature by..."
"The findings suggest" → "a strong correlation between..."
"Further investigation" → "is needed to determine..."
```

### Note Organization
```
"## Summary" → [AI provides section structure]
"### Key Points" → [AI suggests bullet points]
"Related:" → "[[Note 1]], [[Note 2]]"
```

## Integration with Other Features

### With Custom Prompts
- Completions respect active prompts
- Suggestions match prompt style
- Consistency across features

### With Chat
- Similar AI understanding
- Complementary workflows
- Shared context awareness

### With Rewrite
- Completions for drafting
- Rewrite for major edits
- Combined for efficiency

## Conclusion

IDE-Style Completions transform your writing experience by providing intelligent, context-aware suggestions exactly when you need them. By understanding how to use this feature effectively, you can:

- Write faster without sacrificing quality
- Maintain consistency across documents
- Overcome writer's block
- Learn new writing patterns
- Focus on ideas rather than mechanics

Start with completions enabled during regular note-taking, observe how the AI understands your context, and gradually incorporate suggestions into your workflow. Remember: completions are a tool to enhance, not replace, your unique writing voice.

The key is finding the right balance—knowing when to accept suggestions and when to write freely. With practice, completions become an invisible assistant that helps you express your thoughts more efficiently.