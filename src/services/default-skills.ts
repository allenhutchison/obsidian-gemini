/**
 * Default skills content for Gemini Scribe
 * Following Anthropic's skill-creator best practices:
 * - SKILL.md < 500 lines (core guidance only)
 * - references/ folder for detailed documentation (on-demand loading)
 * - Progressive disclosure design
 */

// =============================================================================
// OBSIDIAN MARKDOWN SKILL
// =============================================================================

export const OBSIDIAN_MARKDOWN_SKILL = `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, properties, or Obsidian notes.
---

# Obsidian Markdown

## Quick Decision Guide

| User Intent | Action |
|-------------|--------|
| Create a new note | Include YAML frontmatter + title heading |
| Link to another note | Use \`[[wikilinks]]\` (not markdown links) |
| Highlight important info | Use callouts \`> [!note]\` |
| Track tasks | Use task lists \`- [ ]\` |
| Add metadata | Use YAML properties in frontmatter |
| Embed content | Use \`![[embed]]\` syntax |

## Essential Patterns

### New Note Template
\`\`\`markdown
---
title: Note Title
date: {{date}}
tags:
  - tag1
---

# Note Title

Content here...
\`\`\`

### Wikilinks
\`\`\`markdown
[[Note Name]]                    Link to note
[[Note Name|Display Text]]       Custom display text
[[Note Name#Heading]]            Link to heading
[[#Heading]]                     Link within same note
\`\`\`

### Callouts
\`\`\`markdown
> [!note] Title
> Content here

> [!warning] Important
> Critical information

> [!tip]- Collapsed by default
> Hidden until expanded
\`\`\`

Types: \`note\`, \`info\`, \`tip\`, \`warning\`, \`danger\`, \`example\`, \`quote\`, \`todo\`, \`success\`, \`failure\`, \`bug\`, \`question\`

### Task Lists
\`\`\`markdown
- [ ] Incomplete task
- [x] Completed task
- [ ] Parent task
  - [ ] Subtask
\`\`\`

### Properties (Frontmatter)
\`\`\`yaml
---
title: My Note
date: 2024-01-15
tags: [project, active]
status: in-progress
rating: 4.5
completed: false
related: "[[Other Note]]"
---
\`\`\`

### Embeds
\`\`\`markdown
![[Note Name]]                   Embed entire note
![[Note Name#Heading]]           Embed section
![[image.png|300]]               Embed image with width
\`\`\`

### Formatting
| Style | Syntax |
|-------|--------|
| Bold | \`**text**\` |
| Italic | \`*text*\` |
| Highlight | \`==text==\` |
| Strikethrough | \`~~text~~\` |
| Inline code | \`\\\`code\\\`\` |

## Tool Integration

When working with Obsidian notes:
1. Use \`get_active_file\` to identify current context
2. Use \`read_file\` to check existing note structure before editing
3. Use \`write_file\` for new notes (always include frontmatter)
4. Use \`update_frontmatter\` for metadata changes (safer than full rewrite)
5. Use \`append_content\` to add text to end of note
6. Use \`write_file\` only for full content replacement
7. Use \`list_files\` to discover related notes

## Deep Reference

When you need complete documentation, read these files:
- \`references/callouts.md\` - All 12 callout types with examples
- \`references/properties.md\` - Complete YAML frontmatter guide
- \`references/mermaid.md\` - Diagram syntax (flowcharts, sequence, etc.)
- \`references/math.md\` - LaTeX math expressions
- \`references/embeds.md\` - Advanced embed patterns
`;

export const OBSIDIAN_MARKDOWN_REF_CALLOUTS = `# Callout Types Reference

## Standard Callouts

| Type | Aliases | Color | Use For |
|------|---------|-------|---------|
| \`note\` | - | Blue | General information |
| \`abstract\` | summary, tldr | Teal | Summaries |
| \`info\` | - | Blue | Background info |
| \`tip\` | hint, important | Cyan | Helpful advice |
| \`success\` | check, done | Green | Completed items |
| \`question\` | help, faq | Yellow | Questions/FAQs |
| \`warning\` | caution, attention | Orange | Warnings |
| \`failure\` | fail, missing | Red | Failures |
| \`danger\` | error | Red | Critical errors |
| \`bug\` | - | Red | Bug reports |
| \`example\` | - | Purple | Examples |
| \`quote\` | cite | Gray | Quotations |
| \`todo\` | - | Blue | To-do items |

## Syntax

\`\`\`markdown
> [!type] Optional Title
> Content on multiple lines
> continues here
\`\`\`

## Foldable Callouts

\`\`\`markdown
> [!note]- Collapsed by default
> Hidden content

> [!note]+ Expanded by default
> Visible but collapsible
\`\`\`

## Nested Callouts

\`\`\`markdown
> [!question] Outer
> > [!note] Inner
> > Nested content
\`\`\`
`;

export const OBSIDIAN_MARKDOWN_REF_PROPERTIES = `# Properties (Frontmatter) Reference

## Basic Structure

Properties are YAML frontmatter at the file start:

\`\`\`yaml
---
key: value
---
\`\`\`

## Property Types

| Type | Example | Notes |
|------|---------|-------|
| Text | \`title: My Note\` | Strings |
| Number | \`rating: 4.5\` | Integers or decimals |
| Boolean | \`completed: true\` | true/false |
| Date | \`date: 2024-01-15\` | ISO format |
| DateTime | \`due: 2024-01-15T14:30:00\` | With time |
| List | \`tags: [one, two]\` | Array syntax |
| Link | \`related: "[[Note]]"\` | Quote wikilinks |

## Default Properties

Obsidian recognizes these special properties:
- \`tags\` - Note tags (also usable as #inline)
- \`aliases\` - Alternative names for the note
- \`cssclasses\` - CSS classes for styling

## Complete Example

\`\`\`yaml
---
title: Project Alpha
date: 2024-01-15
tags:
  - project
  - active
aliases:
  - Alpha Project
  - Project A
status: in-progress
priority: high
rating: 4.5
completed: false
due: 2024-02-01T17:00:00
related:
  - "[[Meeting Notes]]"
  - "[[Requirements]]"
cssclasses:
  - wide-page
---
\`\`\`

## Best Practices

1. Always include \`title\` and \`date\` for new notes
2. Use \`tags\` for categorization
3. Use consistent property names across notes
4. Quote wikilinks in property values
`;

export const OBSIDIAN_MARKDOWN_REF_MERMAID = `# Mermaid Diagrams Reference

## Flowcharts

\`\`\`markdown
\\\`\\\`\\\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
\\\`\\\`\\\`
\`\`\`

Directions: \`TD\` (top-down), \`LR\` (left-right), \`BT\`, \`RL\`

## Node Shapes

| Shape | Syntax |
|-------|--------|
| Rectangle | \`[text]\` |
| Rounded | \`(text)\` |
| Stadium | \`([text])\` |
| Diamond | \`{text}\` |
| Circle | \`((text))\` |

## Sequence Diagrams

\`\`\`markdown
\\\`\\\`\\\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi
    Alice->>Bob: How are you?
    Bob-->>Alice: Fine, thanks
\\\`\\\`\\\`
\`\`\`

## Class Diagrams

\`\`\`markdown
\\\`\\\`\\\`mermaid
classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
\\\`\\\`\\\`
\`\`\`

## Linking to Notes

Add this line to make nodes link to Obsidian notes:
\`\`\`
class NodeName internal-link;
\`\`\`
`;

export const OBSIDIAN_MARKDOWN_REF_MATH = `# Math (LaTeX) Reference

## Inline Math

Use single dollar signs:
\`\`\`markdown
The equation $E = mc^2$ is famous.
\`\`\`

## Block Math

Use double dollar signs:
\`\`\`markdown
$$
\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$
\`\`\`

## Common Syntax

| Expression | Syntax | Result |
|------------|--------|--------|
| Superscript | \`x^2\` | x² |
| Subscript | \`x_i\` | xᵢ |
| Fraction | \`\\frac{a}{b}\` | a/b |
| Square root | \`\\sqrt{x}\` | √x |
| Sum | \`\\sum_{i=1}^{n}\` | Σ |
| Integral | \`\\int_a^b\` | ∫ |
| Greek | \`\\alpha \\beta \\gamma\` | αβγ |
| Infinity | \`\\infty\` | ∞ |

## Matrices

\`\`\`markdown
$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$
\`\`\`

## Aligned Equations

\`\`\`markdown
$$
\\begin{aligned}
x &= a + b \\\\
y &= c + d
\\end{aligned}
$$
\`\`\`
`;

export const OBSIDIAN_MARKDOWN_REF_EMBEDS = `# Embeds Reference

## Note Embeds

\`\`\`markdown
![[Note Name]]                   Entire note
![[Note Name#Heading]]           Specific section
![[Note Name#^block-id]]         Specific block
\`\`\`

## Block IDs

Add \`^block-id\` at line end to create linkable blocks:

\`\`\`markdown
This paragraph can be linked. ^my-id

> Quote content
> Multiple lines

^quote-id
\`\`\`

## Image Embeds

\`\`\`markdown
![[image.png]]                   Full size
![[image.png|300]]               Width 300px
![[image.png|300x200]]           Width x Height
\`\`\`

## External Images

\`\`\`markdown
![Alt text](https://example.com/image.png)
![Alt|300](https://example.com/image.png)
\`\`\`

## Audio/Video

\`\`\`markdown
![[audio.mp3]]
![[video.mp4]]
\`\`\`

## PDF Embeds

\`\`\`markdown
![[document.pdf]]
![[document.pdf#page=3]]
![[document.pdf#height=400]]
\`\`\`

## Search Embeds

\`\`\`markdown
\\\`\\\`\\\`query
tag:#project status:active
\\\`\\\`\\\`
\`\`\`
`;

// =============================================================================
// OBSIDIAN BASES SKILL
// =============================================================================

export const OBSIDIAN_BASES_SKILL = `---
name: obsidian-bases
description: Create and edit Obsidian Bases (database-like views) with filters, formulas, and multiple view types. Use when the user wants to create databases, trackers, tables, or organized views of their notes using YAML-based Bases.
---

# Obsidian Bases

## Quick Decision Guide

| User Intent | Recommended View |
|-------------|------------------|
| Track tasks/projects | Table view |
| Visual overview | Cards view |
| Simple listing | List view |
| Location data | Map view |

## Essential Structure

\`\`\`yaml
# In a .base file
filter:
  - note.tags.includes("project")

properties:
  status:
    displayName: "Status"
  priority:
    displayName: "Priority"

views:
  - type: table
    name: "All Projects"
    columns:
      - property: file.name
      - property: status
      - property: priority
\`\`\`

## Core Concepts

1. **filter** - Which notes to include
2. **properties** - Which fields to show
3. **formulas** - Computed values
4. **views** - How to display (table/cards/list/map)

## Filter Examples

\`\`\`yaml
filter:
  # Tag filter
  - note.tags.includes("project")
  
  # Folder filter
  - file.inFolder("Projects")
  
  # Property filter
  - status == "active"
  
  # Combined
  - note.tags.includes("task") && status != "done"
\`\`\`

## Tool Integration

1. Use \`write_file\` to create .base files
2. Use \`update_frontmatter\` for modifying base definitions (properties)
3. Use \`read_file\` to check existing base structure
4. Always validate YAML syntax before writing

## Deep Reference

When you need complete documentation:
- \`references/filters.md\` - All filter operators and functions
- \`references/formulas.md\` - Formula syntax and functions
- \`references/view-types.md\` - Table, Cards, List, Map configuration
`;

export const OBSIDIAN_BASES_REF_FILTERS = `# Bases Filters Reference

## Operators

| Operator | Description |
|----------|-------------|
| \`==\` | Equals |
| \`!=\` | Not equal |
| \`>\` | Greater than |
| \`<\` | Less than |
| \`>=\` | Greater or equal |
| \`<=\` | Less or equal |
| \`&&\` | Logical AND |
| \`\\|\\|\` | Logical OR |
| \`!\` | Logical NOT |

## Functions

| Function | Example |
|----------|---------|
| \`includes()\` | \`note.tags.includes("tag")\` |
| \`startsWith()\` | \`file.name.startsWith("Project")\` |
| \`endsWith()\` | \`file.name.endsWith("2024")\` |
| \`inFolder()\` | \`file.inFolder("Projects")\` |

## Common Patterns

\`\`\`yaml
# By tag
filter:
  - note.tags.includes("project")

# By folder
filter:
  - file.inFolder("Projects")

# By property value
filter:
  - status == "active"

# Multiple conditions
filter:
  - note.tags.includes("task")
  - status != "done"
  - priority > 3

# OR condition
filter:
  - status == "active" || status == "pending"
\`\`\`
`;

export const OBSIDIAN_BASES_REF_FORMULAS = `# Bases Formulas Reference

## Defining Formulas

\`\`\`yaml
formulas:
  total: "price * quantity"
  status_icon: 'if(done, "✅", "⏳")'
  formatted: 'price.toFixed(2) + " USD"'
\`\`\`

## Functions

| Function | Description |
|----------|-------------|
| \`if(cond, true, false)\` | Conditional |
| \`.toFixed(n)\` | Round decimals |
| \`.toUpperCase()\` | Uppercase string |
| \`.toLowerCase()\` | Lowercase string |
| \`.length\` | String/array length |
| \`.mean()\` | Average of list |
| \`.sum()\` | Sum of list |
| \`.round(n)\` | Round to n decimals |

## Examples

\`\`\`yaml
formulas:
  # Status indicator
  status_icon: 'if(completed, "✅", if(in_progress, "🔄", "⏳"))'
  
  # Price formatting
  display_price: 'if(price, "$" + price.toFixed(2), "N/A")'
  
  # Days until due
  days_remaining: 'due ? Math.ceil((due - Date.now()) / 86400000) : null'
  
  # Progress percentage
  progress: 'Math.round((completed_tasks / total_tasks) * 100) + "%"'
\`\`\`
`;

export const OBSIDIAN_BASES_REF_VIEWS = `# Bases View Types Reference

## Table View

\`\`\`yaml
views:
  - type: table
    name: "My Table"
    columns:
      - property: file.name
      - property: status
      - property: priority
      - property: formula.status_icon
    sortBy:
      property: priority
      direction: DESC
    limit: 50
\`\`\`

## Cards View

\`\`\`yaml
views:
  - type: cards
    name: "My Cards"
    coverImage: cover
    title: file.name
    subtitle: status
    properties:
      - priority
      - due
\`\`\`

## List View

\`\`\`yaml
views:
  - type: list
    name: "My List"
    title: file.name
    subtitle: status
\`\`\`

## Map View

\`\`\`yaml
views:
  - type: map
    name: "Locations"
    location: coordinates
    title: file.name
\`\`\`

## Grouping

\`\`\`yaml
views:
  - type: table
    name: "Grouped"
    groupBy:
      property: status
      direction: ASC
\`\`\`
`;

// =============================================================================
// JSON CANVAS SKILL
// =============================================================================

export const JSON_CANVAS_SKILL = `---
name: json-canvas
description: Create and edit Obsidian Canvas files (.canvas) with nodes, groups, and edges. Use when the user wants to create visual canvases, mind maps, diagrams, or spatial layouts of notes and content.
---

# JSON Canvas

## Quick Decision Guide

| User Intent | Use |
|-------------|-----|
| Mind map/brainstorm | Text nodes + edges |
| Note connections | File nodes + edges |
| External resources | Link nodes |
| Organize related items | Groups |

## Essential Structure

\`\`\`json
{
  "nodes": [
    {
      "id": "1",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 250,
      "height": 100,
      "text": "Content here"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "1",
      "toNode": "2",
      "fromSide": "right",
      "toSide": "left"
    }
  ]
}
\`\`\`

## Node Types

| Type | Required Fields |
|------|-----------------|
| text | id, type, x, y, width, height, text |
| file | id, type, x, y, width, height, file |
| link | id, type, x, y, width, height, url |
| group | id, type, x, y, width, height, label |

## Tool Integration

1. Use \`read_file\` to check existing canvas structure (crucial!)
2. Use \`write_file\` with .canvas extension
3. Output must be valid JSON
4. Generate unique IDs for each node/edge

## Deep Reference

- \`references/nodes.md\` - All node types and properties
- \`references/edges.md\` - Edge connections and styling
`;

export const JSON_CANVAS_REF_NODES = `# Canvas Node Types Reference

## Common Properties

All nodes have:
- \`id\` (string) - Unique identifier
- \`type\` (string) - Node type
- \`x\`, \`y\` (number) - Position
- \`width\`, \`height\` (number) - Size
- \`color\` (string, optional) - Background color

## Text Node

\`\`\`json
{
  "id": "unique-id",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 250,
  "height": 100,
  "text": "# Markdown content\\n\\nSupports full markdown.",
  "color": "1"
}
\`\`\`

## File Node

\`\`\`json
{
  "id": "unique-id",
  "type": "file",
  "x": 300,
  "y": 0,
  "width": 400,
  "height": 300,
  "file": "path/to/note.md",
  "subpath": "#heading"
}
\`\`\`

## Link Node

\`\`\`json
{
  "id": "unique-id",
  "type": "link",
  "x": 0,
  "y": 200,
  "width": 250,
  "height": 50,
  "url": "https://example.com"
}
\`\`\`

## Group Node

\`\`\`json
{
  "id": "unique-id",
  "type": "group",
  "x": -50,
  "y": -50,
  "width": 600,
  "height": 400,
  "label": "Group Label",
  "color": "2"
}
\`\`\`

## Colors

Colors 1-6 correspond to Obsidian's palette: red, orange, yellow, green, cyan, purple.
`;

export const JSON_CANVAS_REF_EDGES = `# Canvas Edges Reference

## Edge Structure

\`\`\`json
{
  "id": "unique-id",
  "fromNode": "source-node-id",
  "toNode": "target-node-id",
  "fromSide": "right",
  "toSide": "left",
  "fromEnd": "none",
  "toEnd": "arrow",
  "color": "1",
  "label": "Optional label"
}
\`\`\`

## Side Values

| Side | Description |
|------|-------------|
| \`top\` | Top edge |
| \`right\` | Right edge |
| \`bottom\` | Bottom edge |
| \`left\` | Left edge |

## End Types

| End | Description |
|-----|-------------|
| \`none\` | No arrow |
| \`arrow\` | Arrow head |

## Example Canvas

\`\`\`json
{
  "nodes": [
    {"id": "1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 80, "text": "Start"},
    {"id": "2", "type": "text", "x": 300, "y": 0, "width": 200, "height": 80, "text": "Middle"},
    {"id": "3", "type": "text", "x": 600, "y": 0, "width": 200, "height": 80, "text": "End"}
  ],
  "edges": [
    {"id": "e1", "fromNode": "1", "toNode": "2", "fromSide": "right", "toSide": "left", "toEnd": "arrow"},
    {"id": "e2", "fromNode": "2", "toNode": "3", "fromSide": "right", "toSide": "left", "toEnd": "arrow"}
  ]
}
\`\`\`
`;

// =============================================================================
// SKILL FILE STRUCTURE
// Structure for SkillManager to create all files
// =============================================================================

export interface SkillFileStructure {
	skillName: string;
	skillMd: string;
	references: Record<string, string>;
}

export const DEFAULT_SKILL_STRUCTURES: SkillFileStructure[] = [
	{
		skillName: 'obsidian-markdown',
		skillMd: OBSIDIAN_MARKDOWN_SKILL,
		references: {
			'callouts.md': OBSIDIAN_MARKDOWN_REF_CALLOUTS,
			'properties.md': OBSIDIAN_MARKDOWN_REF_PROPERTIES,
			'mermaid.md': OBSIDIAN_MARKDOWN_REF_MERMAID,
			'math.md': OBSIDIAN_MARKDOWN_REF_MATH,
			'embeds.md': OBSIDIAN_MARKDOWN_REF_EMBEDS,
		},
	},
	{
		skillName: 'obsidian-bases',
		skillMd: OBSIDIAN_BASES_SKILL,
		references: {
			'filters.md': OBSIDIAN_BASES_REF_FILTERS,
			'formulas.md': OBSIDIAN_BASES_REF_FORMULAS,
			'view-types.md': OBSIDIAN_BASES_REF_VIEWS,
		},
	},
	{
		skillName: 'json-canvas',
		skillMd: JSON_CANVAS_SKILL,
		references: {
			'nodes.md': JSON_CANVAS_REF_NODES,
			'edges.md': JSON_CANVAS_REF_EDGES,
		},
	},
];
