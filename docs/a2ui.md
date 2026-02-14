# A2UI: Agent-to-UI Rendering

A2UI enables AI agents to render interactive User Interfaces within Obsidian notes and chat sessions.

## Overview

When the agent outputs a `json:a2ui` code block, Obsidian renders it as an interactive UI component instead of raw JSON:

````text
┌──────────────────────┐      ┌────────────────────────┐
│  Agent Output        │  →   │  Rendered Result       │
├──────────────────────┤      ├────────────────────────┤
│  ```json:a2ui        │      │  📊 Project Dashboard  │
│  { "type": "text",   │      │  ┌────┐ ┌────┐        │
│    "content": "..." }│      │  │ 42 │ │ 12 │        │
│  ```                 │      │  └────┘ └────┘        │
└──────────────────────┘      │  [💾 Save to Vault]   │
                              └────────────────────────┘
````

## Features

| Feature                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| **Visual-only mode**    | No code execution, only rendering for security          |
| **Interactive charts**  | Mermaid diagrams (pie, flowchart, gantt, sequence)      |
| **Save to vault**       | User-controlled save location with configurable default |
| **Progressive loading** | Documentation loads only when agent needs it            |
| **History rendering**   | Works in Reading View of saved chat sessions            |

## Quick Example

```json:a2ui
{
  "type": "container",
  "children": [
    { "type": "text", "variant": "h2", "content": "📊 Status" },
    { "type": "mermaid", "content": "pie\n\"Done\" : 42\n\"WIP\" : 12" },
    { "type": "button", "label": "Save", "action": "save-note", "payload": { "content": "..." } }
  ]
}
```

## Components

| Type        | Properties                              | Description                          |
| ----------- | --------------------------------------- | ------------------------------------ |
| `container` | `direction`, `gap`, `align`, `children` | Layout wrapper (row/column)          |
| `text`      | `content`, `variant` (h1-h6, p)         | Rich Markdown text                   |
| `button`    | `label`, `variant`, `action`, `payload` | Interactive button                   |
| `mermaid`   | `content`                               | Charts, flowcharts, Gantt            |
| `image`     | `src`, `alt`                            | Vault images (external URLs blocked) |
| `icon`      | `name`                                  | Lucide icons                         |
| `input`     | `label`, `placeholder`, `inputType`     | Text input field                     |
| `select`    | `label`, `options`, `value`             | Dropdown selector                    |
| `switch`    | `label`, `checked`                      | Toggle switch                        |

## Actions

| Action      | Payload              | Description                                           |
| ----------- | -------------------- | ----------------------------------------------------- |
| `save-note` | `{ content: "..." }` | Save content to vault (prompts for folder first time) |

## Settings

**Settings → UI Settings → A2UI Save Folder**

- Empty (default): Prompts user for folder on first save
- Set path: Saves directly to configured folder
- Reset button: Clears preference to prompt again

## Security

- **No command execution** - Only visual rendering
- **Style sanitization** - Allowlist + injection prevention
- **External URLs blocked** - Images must be vault-local
- **User-controlled saves** - Explicit folder confirmation

## Architecture

### Token Efficiency (JIT Loading)

The A2UI documentation is not embedded in the system prompt. Instead:

1. System prompt contains a 3-line hint (~40 tokens)
2. Agent loads full docs via `read_file` when needed (~400 tokens)

**Result:** 90% reduction in base context when A2UI is not being used.

### Files

| File                                 | Purpose                        |
| ------------------------------------ | ------------------------------ |
| `prompts/a2uiPrompt.md`              | JIT-loaded agent documentation |
| `src/ui/a2ui/renderer.ts`            | Component rendering engine     |
| `src/ui/a2ui/types.ts`               | TypeScript type definitions    |
| `src/ui/a2ui/folder-select-modal.ts` | Save folder selection UI       |

## Examples

### Dashboard with Stats

```json:a2ui
{
  "type": "container",
  "direction": "column",
  "gap": "16px",
  "children": [
    { "type": "text", "variant": "h2", "content": "📊 Project Status" },
    {
      "type": "container",
      "direction": "row",
      "gap": "12px",
      "children": [
        {
          "type": "container",
          "style": { "padding": "16px", "borderRadius": "8px", "backgroundColor": "var(--background-secondary)" },
          "children": [
            { "type": "icon", "name": "check-circle" },
            { "type": "text", "variant": "h3", "content": "42" },
            { "type": "text", "content": "Completed" }
          ]
        },
        {
          "type": "container",
          "style": { "padding": "16px", "borderRadius": "8px", "backgroundColor": "var(--background-secondary)" },
          "children": [
            { "type": "icon", "name": "clock" },
            { "type": "text", "variant": "h3", "content": "12" },
            { "type": "text", "content": "In Progress" }
          ]
        }
      ]
    },
    { "type": "mermaid", "content": "pie title Tasks\n\"Done\" : 42\n\"In Progress\" : 12\n\"TODO\" : 18" },
    { "type": "button", "label": "💾 Save Report", "variant": "primary", "action": "save-note", "payload": { "content": "# Project Report\n\n- Completed: 42\n- In Progress: 12" } }
  ]
}
```

### Flowchart

```json:a2ui
{
  "type": "container",
  "children": [
    { "type": "text", "variant": "h3", "content": "A2UI Data Flow" },
    { "type": "mermaid", "content": "flowchart LR\n    A[Agent Output] --> B{json:a2ui?}\n    B -->|Yes| C[A2UIRenderer]\n    B -->|No| D[Markdown]\n    C --> E[Interactive UI]" }
  ]
}
```

> **Note for maintainer:** Copy any example above into an Obsidian note to see it render live.
