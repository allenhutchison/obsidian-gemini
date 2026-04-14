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
- **Fix Grammar**: Fixes grammar and improves style.
- **Convert to Bullet Points**: Converts text to a list.

Vault prompts take precedence over bundled prompts if they share the same name, allowing you to customize the behavior of bundled prompts.

## Migrating from the `selection-action` tag

Earlier versions referred to this feature with the tag `selection-action`. The tag has been standardized to `gemini-scribe/selection-prompt` as part of a broader move to namespace plugin-owned tags under `gemini-scribe/*`.

If you have existing prompts tagged `selection-action`, rename the tag in their frontmatter to `gemini-scribe/selection-prompt` and they'll appear in the selection menu again. If you'd like the AI agent to help with the migration, ask it to "update all prompts tagged `selection-action` to use `gemini-scribe/selection-prompt` instead."
