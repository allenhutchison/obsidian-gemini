---
name: obsidian-properties
description: Work with Obsidian note properties (frontmatter). Activate this skill when users want to add, modify, or organize properties, understand property types, format YAML frontmatter, or use properties with templates, search, or Bases.
---

# Obsidian Properties

Properties are structured metadata stored as YAML frontmatter at the top of notes. They enable organization, search, filtering, and integration with features like Bases, Templates, and Search.

**Always use the `update_frontmatter` tool for property changes** — it handles YAML formatting safely via Obsidian's API.

## Property Format

Properties are YAML between `---` delimiters at the very start of a file:

```yaml
---
title: My Note
tags:
  - journal
  - personal
date: 2024-08-21
---
```

- Each property name must be unique within a note
- Names are separated from values by a colon followed by a space
- Order of properties doesn't matter

## Property Types

Once a type is assigned to a property name, all notes in the vault share that type.

### Text

Single line of text. No markdown rendering. Hashtags do NOT create tags.

Internal links must be quoted:

```yaml
title: A New Hope
link: '[[Episode IV]]'
url: https://www.example.com
```

### List

Multiple values, each on its own line with `- `:

```yaml
cast:
  - Mark Hamill
  - Harrison Ford
  - Carrie Fisher
links:
  - '[[Link]]'
  - '[[Link2]]'
```

Internal links in lists must also be quoted.

### Number

Literal integers or decimals only — no expressions or operators:

```yaml
year: 1977
pie: 3.14
```

### Checkbox

Boolean `true` or `false`. Renders as a checkbox in Live Preview:

```yaml
favorite: true
reply: false
```

### Date

Format: `YYYY-MM-DD`

```yaml
date: 2024-08-21
```

With the Daily Notes plugin enabled, date properties function as internal links to daily notes.

### Date & Time

Format: `YYYY-MM-DDTHH:mm:ss`

```yaml
time: 2024-08-21T10:30:00
```

### Tags

Special type used exclusively by the `tags` property. Cannot be assigned to other property names. Formatted as a list:

```yaml
tags:
  - journal
  - personal
  - draft
```

## Default Properties

| Property     | Type | Description                                              |
| ------------ | ---- | -------------------------------------------------------- |
| `tags`       | List | Note tags (also recognized inline with `#tag`)           |
| `aliases`    | List | Alternative names for the note (used in link resolution) |
| `cssclasses` | List | Apply CSS snippets to style individual notes             |

### Obsidian Publish Properties

| Property          | Description                 |
| ----------------- | --------------------------- |
| `publish`         | Whether to publish the note |
| `permalink`       | Custom URL path             |
| `description`     | Page description            |
| `image` / `cover` | Page image                  |

### Deprecated Properties (removed in Obsidian 1.9)

Use the modern equivalents instead:

- `tag` → use `tags`
- `alias` → use `aliases`
- `cssclass` → use `cssclasses`

## JSON Format

Properties can also be defined as JSON (will be converted to YAML on save):

```yaml
---
{ 'tags': ['journal'], 'publish': false }
---
```

## Best Practices

### When Modifying Properties

- **Always use `update_frontmatter`** — never manually edit YAML via `write_file`
- Use canonical names: `tags` not `tag`, `aliases` not `alias`, `cssclasses` not `cssclass`
- Quote internal links: `"[[Note Name]]"` in both text and list properties
- Use proper date format: `YYYY-MM-DD` for dates, `YYYY-MM-DDTHH:mm:ss` for datetimes
- Numbers must be literals — no expressions like `1+1`

### When Writing File Content

- Never place content above or inside the frontmatter block
- "Top of the note" means after the closing `---`, not the first line of the file
- Preserve existing frontmatter exactly when using `write_file`

### Property Design Patterns

- Use `tags` for broad categorization (searchable, filterable in Bases)
- Use custom properties for structured data (status, priority, due dates)
- Use `aliases` so notes can be found by alternative names
- Use `cssclasses` to visually distinguish note types (e.g., `dashboard`, `daily-note`)
- Keep property names consistent across your vault — Obsidian enforces type consistency per name

### Integration with Bases

Properties are the foundation of Bases views. Note properties are accessed as `note.property_name` or just `property_name` in Base filters and formulas. Design your property schema with Bases queries in mind.

## Limitations

- **No nested properties** — use Source mode to view nested YAML if needed
- **No bulk editing** — use external tools or community plugins for mass property changes
- **No markdown in properties** — properties are meant for small, atomic, machine-readable data
- **No duplicate names** — each property name can only appear once per note
