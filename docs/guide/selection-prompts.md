# Selection Prompts

Obsidian Gemini Scribe allows you to create custom prompts that operate on selected text in your editor. These prompts appear in the context menu when you right-click a selection.

## How to Create a Selection Prompt

To create a new selection prompt, create a markdown file in your prompts directory (default: `gemini-scribe/Prompts/`) with the following frontmatter:

```markdown
---
name: 'My Custom Prompt'
description: 'What this prompt does'
tags: ['gemini-scribe/selection-prompt']
---

Your instructions for the AI go here.

You can use the `{{selection}}` placeholder to control where the selected text is inserted.
For example:

Please translate the following text to French:
{{selection}}
```

### Key Requirements

- **Tags**: You MUST include the tag `gemini-scribe/selection-prompt` in the frontmatter for the prompt to appear in the selection menu.
- **Placeholder**: Use `{{selection}}` to specify where the selected text should be placed. If you omit it, the selected text will be appended to the end of your prompt.

## Bundled Prompts

The plugin comes with several bundled selection prompts:

- **Explain Selection**: Gets a clear explanation of the selected text.
- **Summarize Selection**: Gets a concise summary.
- **Explain Code**: Detailed walkthrough of selected code.
- **Translate Selection**: Translates text.
- **Fix Grammar**: Fixes grammar and improves style.
- **Convert to Bullet Points**: Converts text to a list.

Vault prompts take precedence over bundled prompts if they share the same name, allowing you to customize the behavior of bundled prompts.
