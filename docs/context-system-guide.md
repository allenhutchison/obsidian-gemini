# Context System Guide

The Context System is the intelligence behind Gemini Scribe's ability to understand your notes and their relationships. It automatically includes relevant content from your current note and linked notes when communicating with the AI.

## Table of Contents

- [Overview](#overview)
- [How Context Works](#how-context-works)
- [Configuration](#configuration)
- [Context Depth Explained](#context-depth-explained)
- [Optimizing Context](#optimizing-context)
- [Advanced Usage](#advanced-usage)
- [Performance Considerations](#performance-considerations)
- [Troubleshooting](#troubleshooting)

## Overview

### What is the Context System?

The Context System:
- Automatically includes your current note in AI conversations
- Follows links to include related notes
- Builds a knowledge graph for the AI
- Respects your privacy and vault structure
- Works transparently in the background

### Why Context Matters

With context, the AI can:
- Understand your specific content
- Reference related information
- Maintain consistency across notes
- Provide relevant suggestions
- Answer questions about your knowledge base

## How Context Works

### The Context Building Process

1. **Current Note**: Always included (if enabled)
2. **Link Discovery**: Finds all [[wiki-links]] and [markdown](links)
3. **Depth Traversal**: Follows links based on your setting
4. **Content Assembly**: Combines all relevant notes
5. **AI Processing**: Sends context with your query

### What Gets Included

**From Current Note**:
- Full text content
- Frontmatter metadata
- Code blocks
- Lists and tables
- Embedded content

**From Linked Notes**:
- Notes referenced with [[wiki-links]]
- Notes with [markdown links](note.md)
- Embedded notes with ![[embedding]]
- Transclusions and references

### What's Excluded

- Attachments (images, PDFs)
- External links (websites)
- Broken or missing links
- Excluded folders (if configured)
- System files

## Configuration

### Basic Settings

In Settings → Gemini Scribe:

1. **Send Context**: Master toggle
   - ON: Include note content
   - OFF: Chat without context

2. **Max Context Depth**: How deep to follow links
   - 0: Only current note
   - 1: Current + directly linked
   - 2: Current + linked + their links
   - 3+: Deeper traversal

### Depth Guidelines

| Depth | Includes | Best For | Performance |
|-------|----------|----------|-------------|
| 0 | Current note only | Simple queries, isolated notes | Fastest |
| 1 | Current + direct links | Most use cases | Fast |
| 2 | Two levels of links | Research, wikis | Moderate |
| 3+ | Deep traversal | Complex knowledge graphs | Slower |

## Context Depth Explained

### Depth 0: Current Note Only

```
Current Note: "Project Planning"
Context includes: Only "Project Planning"
```

Use when:
- Working on standalone documents
- Note has no relevant links
- Want fastest response
- Discussing specific content

### Depth 1: Direct Links

```
Current Note: "Project Planning"
  Links to: "Budget", "Timeline", "Team"
Context includes: All 4 notes
```

Use when:
- Note has related documents
- Need immediate references
- Standard knowledge work
- Balanced performance

### Depth 2: Secondary Links

```
Current Note: "Project Planning"
  Links to: "Budget"
    Links to: "Q1 Expenses", "Q2 Projections"
  Links to: "Timeline"
    Links to: "Milestones", "Dependencies"
Context includes: All 7 notes
```

Use when:
- Working with interconnected knowledge
- Research projects
- Complex documentation
- Can accept slower responses

### Depth 3+: Deep Traversal

```
Current Note: "Project Planning"
  Links to: "Budget"
    Links to: "Q1 Expenses"
      Links to: "Vendor Contracts"
        Links to: [continues...]
```

Use when:
- Entire knowledge base is relevant
- Comprehensive analysis needed
- Performance is not critical
- Small, focused vaults

## Optimizing Context

### 1. Structure Your Notes

**Hub Notes**:
```markdown
# Project Hub

## Overview
Main project documentation

## Related Documents
- [[Project Planning]]
- [[Technical Specs]]
- [[Meeting Notes]]
- [[Decision Log]]
```

**Atomic Notes**:
- One concept per note
- Clear, descriptive titles
- Explicit links
- Avoid deep nesting

### 2. Strategic Linking

**Do Link**:
- Related concepts
- Supporting documents
- References and sources
- Definitions and glossaries

**Don't Link**:
- Every mention
- Irrelevant tangents
- Circular references
- Archive/old versions

### 3. Context Boundaries

**Create Boundaries**:
```markdown
# Technical Documentation

Internal notes - don't follow these in context:
<!-- [[Private Notes]] -->
<!-- [[Draft Ideas]] -->

Public documentation - include in context:
- [[API Reference]]
- [[User Guide]]
```

### 4. Metadata Usage

Use frontmatter for context:
```markdown
---
project: Alpha
status: active
tags: [important, technical]
related: 
  - "[[Architecture Doc]]"
  - "[[API Design]]"
---
```

## Advanced Usage

### 1. Context Windows

**Managing Large Contexts**:
- AI has token limits
- Large contexts may be truncated
- Prioritize important content
- Use focused queries

**Strategies**:
1. Start specific, expand if needed
2. Use depth 1 for most queries
3. Increase depth selectively
4. Break complex questions into parts

### 2. Dynamic Context

**Switching Context**:
1. Change active note
2. Context updates automatically
3. New conversation perspective
4. Different knowledge subset

**Multi-Note Workflows**:
- Open different notes for different contexts
- Compare AI responses across contexts
- Build comprehensive understanding

### 3. Context-Aware Prompting

**Reference Context**:
```
"Based on the linked budget documents, what's our Q2 projection?"
```

**Explore Connections**:
```
"How do the ideas in the linked notes relate to each other?"
```

**Synthesize Information**:
```
"Summarize the key themes across all the included context"
```

### 4. Specialized Vaults

**Research Vault**:
- High interconnection
- Use depth 2-3
- Focus on synthesis

**Project Vault**:
- Moderate linking
- Use depth 1-2
- Balance speed/context

**Journal Vault**:
- Minimal linking
- Use depth 0-1
- Fast, focused responses

## Performance Considerations

### Context Size Impact

| Context Size | Response Time | Quality |
|--------------|---------------|---------|
| < 1000 words | 1-2 seconds | Focused |
| 1000-5000 | 2-5 seconds | Comprehensive |
| 5000-10000 | 5-10 seconds | Very detailed |
| > 10000 | 10+ seconds | May truncate |

### Optimization Tips

1. **Start Small**: Begin with depth 0-1
2. **Monitor Performance**: Note response times
3. **Adjust as Needed**: Increase depth gradually
4. **Profile Your Vault**: Understand link density

### Memory and Processing

**Large Vaults**:
- More memory usage at higher depths
- Exponential growth with depth
- Consider vault structure
- May need to limit depth

**Circular References**:
- Automatically detected
- Prevented from infinite loops
- Each note included once
- No performance penalty

## Troubleshooting

### Context Not Working

1. **Check Settings**
   - "Send Context" is ON
   - Depth is greater than 0
   - Note is open in editor

2. **Verify Links**
   - Links use correct syntax
   - Target notes exist
   - No typos in note names

3. **Test Incrementally**
   - Start with depth 0
   - Verify current note included
   - Increase depth gradually

### Missing Expected Content

**Note Not Included**:
- Check link syntax
- Verify note exists
- Look for typos
- Check if within depth limit

**Partial Content**:
- May exceed token limit
- Check for parsing errors
- Verify markdown syntax
- Look for special characters

### Performance Issues

**Slow Responses**:
1. Reduce context depth
2. Simplify note structure
3. Break up large notes
4. Use focused queries

**Timeouts**:
- Context too large
- Network issues
- Reduce depth
- Try again with smaller context

### Unexpected Behavior

**Wrong Context**:
- Verify active note
- Check for multiple windows
- Ensure correct note focused
- Restart if needed

**Inconsistent Results**:
- Context may vary by query
- Token limits affect inclusion
- Order matters for large contexts
- Try rephrasing query

## Best Practices

### 1. Vault Organization

**For Optimal Context**:
- Clear hierarchy
- Meaningful links
- Avoid over-linking
- Group related content

### 2. Link Hygiene

**Regular Maintenance**:
- Fix broken links
- Remove outdated references
- Update moved notes
- Consolidate duplicates

### 3. Context Testing

**Verify Context**:
```
"What notes are included in your current context?"
"Summarize all the information you have access to"
```

### 4. Progressive Enhancement

1. Start with no context
2. Add current note
3. Include direct links
4. Expand as needed

## Use Case Examples

### Academic Research

```markdown
# Literature Review

## Core Papers
- [[Smith 2023 - AI in Education]]
- [[Jones 2024 - Learning Methods]]
- [[Brown 2023 - Technology Impact]]

## Synthesis
[Your analysis here]
```
**Context Depth**: 2 (include papers and their references)

### Project Management

```markdown
# Sprint Planning

## This Sprint
- [[Feature A Spec]]
- [[Feature B Design]]
- [[Bug Fixes List]]

## Dependencies
- [[API Documentation]]
- [[Database Schema]]
```
**Context Depth**: 1 (include immediate dependencies)

### Creative Writing

```markdown
# Chapter 5

## Characters in Scene
- [[Emma - Character Profile]]
- [[David - Character Profile]]

## Location
- [[Coffee Shop - Setting]]

## Previous Chapter
- [[Chapter 4 - The Meeting]]
```
**Context Depth**: 1 (include character/setting details)

### Technical Documentation

```markdown
# API Endpoint Reference

## Authentication
See: [[Auth Flow Documentation]]

## Related Endpoints
- [[User Endpoints]]
- [[Data Endpoints]]

## Examples
- [[API Usage Examples]]
```
**Context Depth**: 1-2 (include related docs and examples)

## Integration with Other Features

### With Custom Prompts

Context + Prompts = Powerful combination:
- Prompt sets behavior
- Context provides information
- AI uses both effectively

### With Rewrite

Context informs rewrites:
- Maintains consistency
- References related docs
- Preserves terminology

### With Completions

Context improves suggestions:
- Relevant to your content
- Consistent with linked notes
- Aware of your terminology

## Conclusion

The Context System is the foundation of Gemini Scribe's intelligence. By understanding how to structure your notes and configure context depth, you can:

- Get more relevant AI responses
- Maintain consistency across your vault
- Leverage your entire knowledge base
- Balance performance with comprehensiveness

Remember: Context is about quality, not quantity. Well-structured notes with thoughtful linking at moderate depth often outperform deep traversal of poorly organized content.

Start with depth 1 for most use cases, experiment with your specific vault structure, and adjust based on your needs. The goal is to provide the AI with exactly the information it needs to help you effectively.