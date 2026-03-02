---
name: ui-ux-guidelines
description: >-
  UI/UX best practices for obsidian-gemini plugin development. Covers modal
  sizing, text overflow, message formatting, collapsible UI, animations, icons,
  file chips, session state, CSS containment, and theme compatibility. Use this
  skill when building or modifying UI components.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Specific to the obsidian-gemini repository.
---

# UI/UX Best Practices

## When to use this skill

Use this skill when:

- Building or modifying UI components in the plugin
- Implementing views, modals, or interactive elements
- Working on styling, layout, or theming
- Reviewing UI code for consistency and quality

For Obsidian-specific API guidance (views, modals, workspace, DOM helpers), also refer to the **obsidian-plugin-development** skill.

## Guidelines

### 1. Modal Sizing

Use the `:has()` CSS selector to target parent containers for proper width constraints. Obsidian wraps modal content in container elements, so direct width on the modal class may not be enough.

```css
.modal-container:has(.my-modal) {
	max-width: 800px;
}
```

### 2. Text Overflow

Always handle long text with `text-overflow: ellipsis` and proper flex constraints. This prevents layout breaking with long file names, paths, or user input.

```css
.truncated-text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0; /* Required for flex children */
}
```

### 3. Message Formatting

Convert single newlines to double newlines for proper Markdown rendering in chat and agent views. Obsidian's Markdown renderer requires double newlines for paragraph breaks.

### 4. Collapsible UI

Use compact views by default with expandable details for complex information. This keeps the interface clean while still providing access to detailed data (e.g., tool call results, debug info, context trees).

### 5. Animations

Add subtle transitions and animations for a professional feel. Use CSS transitions for state changes (expand/collapse, show/hide) rather than abrupt visibility toggling.

```css
.expandable {
	transition: max-height 0.2s ease-out;
	overflow: hidden;
}
```

### 6. Icon Usage

Use Obsidian's built-in Lucide icons via `setIcon()` for consistency with the Obsidian ecosystem. Do not import icon libraries separately.

```typescript
import { setIcon } from 'obsidian';

const iconEl = containerEl.createDiv('my-icon');
setIcon(iconEl, 'file-text');
```

### 7. File Chips (@ mentions and file references)

When implementing @ mentions or file reference chips:

- Use `contenteditable` divs with proper event handling
- Convert chips to Markdown links (`[[file]]`) when saving to history
- Position cursor after chip insertion for natural typing flow
- Handle backspace to delete chips as single units

### 8. Session State

Maintain clean session boundaries:

- Clear context files when creating new sessions
- Reset permissions and state when loading from history
- Track session-level settings separately from global settings
- Do not carry over stale state between sessions

### 9. CSS Containment

Ensure proper CSS containment to prevent overflow issues. Use `overflow: hidden` or `overflow: auto` on containers that might have variable-size content. Set explicit dimensions or max-dimensions on containers.

### 10. Theme Compatibility

Use Obsidian's theme CSS variables for consistent styling. Test with different Obsidian themes (light and dark).

```css
/* GOOD: Uses theme variables */
.my-element {
	color: var(--text-normal);
	background-color: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
}

/* BAD: Hardcoded colors */
.my-element {
	color: #333;
	background-color: white;
}
```

Key theme variables:

- `--text-normal`, `--text-muted`, `--text-faint` for text colors
- `--background-primary`, `--background-secondary` for backgrounds
- `--background-modifier-border` for borders
- `--interactive-accent` for interactive/highlighted elements
- `--font-ui-small`, `--font-ui-medium` for font sizes
