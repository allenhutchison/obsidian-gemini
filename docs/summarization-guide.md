# Document Summarization Guide

The Document Summarization feature uses AI to generate concise, one-sentence summaries of your notes, automatically storing them in the note's frontmatter for easy access and organization.

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Using Summarization](#using-summarization)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [Tips for Better Summaries](#tips-for-better-summaries)
- [Working with Summaries](#working-with-summaries)
- [Troubleshooting](#troubleshooting)

## Overview

### What Summarization Does

- Analyzes your entire note content
- Generates a concise, one-sentence summary
- Automatically adds the summary to your note's frontmatter
- Uses a dedicated AI model optimized for summarization

### Benefits

1. **Quick Overview**: See what a note contains at a glance
2. **Better Organization**: Use summaries in dataview queries
3. **Improved Search**: Find notes by their summary content
4. **Memory Aid**: Quickly recall note contents without opening
5. **Sharing**: Easily describe notes to others

## How It Works

### The Summarization Process

1. **Content Analysis**: The AI reads your entire note
2. **Key Point Extraction**: Identifies main themes and ideas
3. **Synthesis**: Combines key points into one sentence
4. **Frontmatter Update**: Adds summary to note metadata

### AI Model

- Uses a fast, efficient model (typically Gemini Flash)
- Optimized for quick, accurate summarization
- Separate from chat model for better performance

## Using Summarization

### Generate a Summary

1. Open the note you want to summarize
2. Open command palette (`Ctrl/Cmd + P`)
3. Search for "Gemini Scribe: Summarize Active File"
4. Press Enter

### What Happens

1. A loading notice appears
2. The AI processes your note (usually 1-3 seconds)
3. Summary is added to frontmatter
4. Success notice confirms completion

### Example

**Before:**
```markdown
# Meeting Notes - Project Alpha

Discussed timeline changes, budget concerns, and new feature requests...
[long content]
```

**After:**
```markdown
---
summary: "Project Alpha meeting covered timeline adjustments due to budget constraints and approved three new feature requests for Q2 development."
---

# Meeting Notes - Project Alpha

Discussed timeline changes, budget concerns, and new feature requests...
[long content]
```

## Configuration

### Settings

In Settings → Gemini Scribe:

1. **Summary Model**: Choose the AI model for summarization
   - Gemini 1.5 Flash (recommended for speed)
   - Gemini 1.5 Flash-8B (fastest, good quality)
   - Gemini 1.5 Pro (highest quality, slower)

2. **Summary Frontmatter Key**: Customize the metadata field
   - Default: `summary`
   - Change to: `description`, `abstract`, `brief`, etc.

### Model Selection Guide

| Model | Speed | Quality | Best For |
|-------|-------|---------|----------|
| Flash-8B | Fastest | Good | Daily notes, quick captures |
| Flash | Fast | Better | Most use cases |
| Pro | Slower | Best | Important documents, publications |

## Use Cases

### 1. Daily Notes

Summarize daily notes for monthly reviews:
```markdown
---
summary: "Completed API integration, attended planning meeting, and started documentation for new features."
---
```

### 2. Meeting Notes

Quick overview of meeting outcomes:
```markdown
---
summary: "Team agreed to extend deadline by two weeks and allocate additional resources to testing phase."
---
```

### 3. Research Notes

Capture essence of research findings:
```markdown
---
summary: "Study demonstrates 40% improvement in performance using new caching strategy with minimal memory overhead."
---
```

### 4. Book Notes

Summarize key takeaways:
```markdown
---
summary: "Explores how deliberate practice and focused attention lead to expertise, emphasizing quality over quantity in skill development."
---
```

### 5. Project Documentation

Create quick project descriptions:
```markdown
---
summary: "Customer feedback system using React frontend and Node.js backend with real-time updates via WebSocket."
---
```

## Tips for Better Summaries

### 1. Well-Structured Notes

The AI summarizes better when notes are organized:
- Use clear headings
- Include introduction paragraphs
- Group related content
- Use lists for key points

### 2. Sufficient Content

- Very short notes may get generic summaries
- Include at least 3-4 paragraphs for best results
- Add context about purpose or goals

### 3. Clear Writing

- Use specific language
- Avoid excessive jargon
- Include concrete examples
- State conclusions explicitly

### 4. Update Summaries

Regenerate summaries when:
- Note content changes significantly
- You refine the note structure
- Original summary seems inaccurate

## Working with Summaries

### 1. Dataview Queries

List notes with summaries:
```dataview
TABLE summary
FROM "Projects"
WHERE summary
SORT file.mtime DESC
```

### 2. Search and Filter

Find notes by summary content:
- Search: `summary:"budget"`
- Filter in graph view
- Use in Smart Folders

### 3. Note Templates

Include summary field in templates:
```markdown
---
created: {{date}}
summary: 
tags: []
---
```

### 4. Index Pages

Create automatic indexes:
```dataview
LIST summary
FROM "Meetings"
WHERE date(file.name) >= date(today) - dur(7 days)
```

### 5. Export and Share

Summaries make sharing easier:
- Include in exported PDFs
- Use in email descriptions
- Add to project overviews

## Advanced Techniques

### 1. Batch Summarization

Summarize multiple notes:
1. Use Templater or QuickAdd
2. Create macro to run command
3. Apply to selected notes

### 2. Custom Summary Styles

Influence summary style by note structure:
- **Action-focused**: Start with verbs
- **Descriptive**: Use adjectives
- **Technical**: Include specific terms

### 3. Summary Templates

Guide AI with structure:
```markdown
# Purpose
[What this note achieves]

# Key Points
[Main ideas]

# Conclusion
[Final thoughts]
```

### 4. Multi-Language Support

The AI can summarize in various languages:
- Writes summary in note's primary language
- Handles mixed-language content
- Maintains technical terms appropriately

## Troubleshooting

### Summary Not Appearing

1. **Check Frontmatter**
   - Ensure note allows frontmatter
   - Look for YAML syntax errors
   - Verify frontmatter position (must be at start)

2. **Check Settings**
   - Confirm API key is valid
   - Verify summary model is selected
   - Check frontmatter key setting

### Poor Quality Summaries

**Too Generic**
- Add more specific content
- Include concrete examples
- State main purpose clearly

**Too Long**
- This is rare but can happen with complex notes
- Consider breaking into multiple notes
- Focus on key message

**Missing Key Points**
- Reorganize with clear headings
- Put important info early
- Use emphasis for key concepts

### Performance Issues

**Slow Generation**
- Switch to faster model (Flash-8B)
- Check internet connection
- Reduce note length if extreme

**Failures**
- Very long notes may timeout
- Check for special characters
- Ensure proper markdown syntax

## Best Practices

### 1. Regular Summarization

- Summarize after major edits
- Include in note creation workflow
- Batch summarize weekly

### 2. Summary Review

- Read generated summaries
- Edit if needed (they're just frontmatter)
- Use as quality check for note clarity

### 3. Consistent Usage

- Decide on summary style for note types
- Use same frontmatter key throughout
- Document your summarization practices

### 4. Integration

Combine with other features:
- Use summaries in custom prompts
- Reference in chat conversations
- Include in rewrite operations

## Examples of Good Summaries

### Technical Note
"Implemented Redis caching layer reducing API response time by 60% through strategic key expiration and lazy loading patterns."

### Meeting Note
"Q3 planning meeting established three priority initiatives: mobile app launch, API v2 development, and customer dashboard redesign."

### Research Note
"Analysis of 50 user interviews reveals primary pain points in onboarding flow, with 80% citing confusion around initial configuration steps."

### Personal Note
"Reflections on productivity experiment show morning writing sessions yield 3x output compared to evening work, suggesting schedule adjustment needed."

### Tutorial Note
"Step-by-step guide for configuring GitHub Actions CI/CD pipeline with automated testing, security scanning, and deployment to AWS."

## Conclusion

Document summarization is a powerful feature that enhances your note-taking workflow. By automatically generating concise summaries, you can:

- Navigate large vaults more easily
- Find information faster
- Share knowledge more effectively
- Build better organizational systems

Start with your most important notes and expand from there. The more you use summarization, the more valuable your note metadata becomes.