---
capability: a2ui
trigger: user requests visual output, charts, forms, dashboards, or structured layouts
version: 1.0
---

# A2UI: Agent-to-UI Rendering

Render interactive User Interfaces using `json:a2ui` code blocks.

## When to Use

- User asks for visual plans, forms, dashboards, or structured layouts
- Complex response benefits from visual presentation (timelines, comparisons)
- Data that benefits from charts or diagrams

## Syntax

```json:a2ui
{
  "type": "container",
  "direction": "column",
  "children": [ ... ]
}
```

## Component Reference

| Type        | Properties                              | Description               |
| ----------- | --------------------------------------- | ------------------------- |
| `container` | `direction`, `gap`, `align`, `children` | Layout wrapper            |
| `text`      | `content`, `variant` (h1-h6, p)         | Rich markdown text        |
| `button`    | `label`, `variant`, `action`, `payload` | Interactive button        |
| `mermaid`   | `content`                               | Charts, flowcharts, Gantt |
| `image`     | `src`, `alt`                            | Local vault images        |
| `icon`      | `name`                                  | Lucide icon               |
| `input`     | `label`, `placeholder`, `inputType`     | Text field                |
| `select`    | `label`, `options`, `value`             | Dropdown                  |
| `switch`    | `label`, `checked`                      | Toggle                    |

## Actions

| Action      | Payload              | Description                                            |
| ----------- | -------------------- | ------------------------------------------------------ |
| `save-note` | `{ content: "..." }` | Save to user's vault (prompts for location first time) |

## Example

```json:a2ui
{
  "type": "container",
  "children": [
    { "type": "text", "variant": "h2", "content": "Project Overview" },
    { "type": "mermaid", "content": "pie title Tasks\n\"Done\" : 42\n\"In Progress\" : 25\n\"TODO\" : 33" },
    { "type": "button", "label": "Save to Vault", "variant": "primary", "action": "save-note", "payload": { "content": "# Project Overview\n\n..." } }
  ]
}
```

## Notes

- Images: Use vault-relative paths or data URIs (external URLs blocked)
- Mermaid: Full Obsidian Mermaid support (pie, flowchart, gantt, sequence, etc.)
- Saved files render properly in Reading View via registered code block processor
