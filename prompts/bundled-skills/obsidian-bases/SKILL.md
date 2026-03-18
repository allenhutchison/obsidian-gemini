---
name: obsidian-bases
description: Create and configure Obsidian Bases — database-like views of notes. Activate this skill when users want to create bases, write filters, formulas, or set up table/cards/list/map views.
---

# Obsidian Bases

Bases is a core Obsidian plugin that creates database-like views of notes. A base can display, edit, sort, and filter files and their properties using table, cards, list, or map views.

All data lives in local Markdown files and their properties. Views are described by Bases syntax (YAML), saved as `.base` files or embedded in code blocks.

## Creating a Base

**As a file:** Command palette → `Bases: Create new base`, or right-click a folder → `New base`.

**Embedded in a note:** Use a `base` code block:

````
```base
filters:
  and:
    - file.hasTag("example")
views:
  - type: table
    name: Table
```
````

**Embed an existing base:** `![[File.base]]` or `![[File.base#ViewName]]`.

**Important:** Embedded base code blocks only render in Reading view or Live Preview mode. They appear as raw YAML in Source mode. After creating an embedded base, let the user know they may need to switch to Reading view to see it rendered.

## Bases Syntax (YAML)

A base file has these top-level sections, all optional:

```yaml
filters: # Global filters applied to all views
formulas: # Calculated properties
properties: # Display configuration (e.g., column headers)
summaries: # Custom summary formulas
views: # One or more view definitions
```

### Filters

By default a base includes every file in the vault. Filters narrow the dataset.

Filters can be applied globally (all views) or per-view. Both use the same syntax and are combined with AND when both are present.

```yaml
filters:
  and:
    - file.hasTag("project")
    - 'status != "done"'
  or:
    - file.inFolder("Work")
    - file.inFolder("Personal")
  not:
    - file.hasTag("archived")
```

Filter statements are strings that evaluate to true/false using comparison operators or functions.

### Formulas

Calculated properties defined in the base:

```yaml
formulas:
  total_cost: 'price * quantity'
  formatted_price: 'if(price, "$" + price.toFixed(2), "")'
  deadline: 'start_date + "2w"'
  overdue: 'if(due_date < now() && status != "Done", "Overdue", "")'
```

Formula values are YAML strings. Use nested quotes for text literals.

### Property References

- **Note properties** (frontmatter): `price`, `status`, or `note.price`
- **File properties** (built-in): `file.name`, `file.size`, `file.mtime`, `file.ctime`, `file.ext`, `file.folder`, `file.tags`, `file.links`
- **Formula properties**: `formula.total_cost`
- **`this`**: refers to the base file itself, the embedding file, or the active file (in sidebar)

### Properties Section

Configure display names for columns:

```yaml
properties:
  status:
    displayName: Status
  formula.total_cost:
    displayName: 'Total Cost'
```

### Views Section

```yaml
views:
  - type: table # table, cards, list, map
    name: 'My Table'
    limit: 10
    filters: # view-specific filters
      and:
        - 'status != "done"'
    order: # column/property order
      - file.name
      - note.status
      - formula.total_cost
    sort: # sort rows (list of property + direction)
      - property: file.mtime
        direction: DESC
    groupBy: # group rows by a property
      property: note.status
      direction: ASC # or DESC
    summaries:
      formula.total_cost: Sum
```

**Sorting:** Use `sort` (NOT `sorts`) — a list of objects with `property` and `direction` (ASC/DESC). Supports multiple sort criteria. `groupBy` is separate and controls row grouping.

### Summaries

Built-in summaries: Average, Min, Max, Sum, Range, Median, Stddev (numbers); Earliest, Latest, Range (dates); Checked, Unchecked (booleans); Empty, Filled, Unique (any type).

Custom summaries use the `values` keyword (list of all values for that property):

```yaml
summaries:
  weighted_avg: 'values.mean().round(3)'
```

## Operators

### Arithmetic

`+`, `-`, `*`, `/`, `%`, `( )`

### Comparison

`==`, `!=`, `>`, `<`, `>=`, `<=`

### Boolean

`!` (not), `&&` (and), `||` (or)

### Date Arithmetic

Add/subtract durations: `date + "1M"`, `date - "2h"`, `now() + "7d"`

Duration units: `y`/`year`/`years`, `M`/`month`/`months`, `d`/`day`/`days`, `w`/`week`/`weeks`, `h`/`hour`/`hours`, `m`/`minute`/`minutes`, `s`/`second`/`seconds`

Subtracting two dates returns milliseconds.

## Key Functions

### Global

- `now()` — current datetime
- `today()` — current date (time zeroed)
- `date("YYYY-MM-DD HH:mm:ss")` — parse date
- `if(condition, trueResult, falseResult?)` — conditional
- `link(path, display?)` — create link
- `image(path)` — render image
- `icon(name)` — render Lucide icon
- `list(element)` — wrap in list
- `min(a, b, ...)`, `max(a, b, ...)` — numeric min/max
- `number(input)` — convert to number
- `duration(value)` — parse duration string
- `html(string)` — render HTML

### Date Methods

- `.format("YYYY-MM-DD")` — format date (Moment.js syntax)
- `.date()` — strip time portion
- `.time()` — get time string
- `.relative()` — human-readable relative time (e.g., "3 days ago")
- `.year`, `.month`, `.day`, `.hour`, `.minute`, `.second` — date fields

### String Methods

- `.contains(value)`, `.containsAll(...)`, `.containsAny(...)`
- `.startsWith(q)`, `.endsWith(q)`
- `.lower()`, `.title()`, `.trim()`
- `.replace(pattern, replacement)` — supports regex
- `.split(separator, limit?)`, `.slice(start, end?)`
- `.length` — character count
- `.isEmpty()`

### Number Methods

- `.round(digits?)`, `.ceil()`, `.floor()`, `.abs()`
- `.toFixed(precision)` — returns string
- `.isEmpty()`

### List Methods

- `.contains(value)`, `.containsAll(...)`, `.containsAny(...)`
- `.filter(value > 2)` — uses `value` and `index` variables
- `.map(value + 1)` — transform elements
- `.reduce(acc + value, 0)` — reduce to single value
- `.sort()`, `.reverse()`, `.unique()`, `.flat()`
- `.join(separator)`, `.slice(start, end?)`
- `.length`, `.isEmpty()`

### File Methods

- `file.hasTag("tag1", "tag2")` — has any of the tags
- `file.inFolder("folder")` — in folder or subfolders
- `file.hasLink(otherFile)` — links to file
- `file.hasProperty("name")` — has frontmatter property
- `file.asLink(display?)` — convert to link

## View Types

### Table

Rows = files, columns = properties. Supports summaries, grouping, sorting, keyboard shortcuts (Ctrl+C/V, Tab navigation, Enter to edit).

### Cards

Grid layout with optional cover images. Settings: card size, image property (link, URL, or hex color), image fit (cover/contain), aspect ratio.

### List

Bulleted, numbered, or plain list. Can indent properties under primary item or use separators.

### Map

Interactive map with markers. Requires the Maps plugin (Obsidian 1.10+). Coordinates stored as `"lat, lng"` text or `[lat, lng]` list. Supports custom marker icons (Lucide names) and colors (hex, RGB, CSS).

## Common Patterns

**Task tracker:**

```yaml
filters:
  and:
    - file.hasTag("task")
formulas:
  overdue: 'if(due_date < today() && status != "Done", "Overdue", "")'
views:
  - type: table
    name: Tasks
    groupBy:
      property: note.status
      direction: ASC
```

**Reading list:**

```yaml
filters:
  and:
    - file.hasTag("book")
views:
  - type: cards
    name: Library
```

**Project dashboard:**

```yaml
filters:
  and:
    - file.inFolder("Projects")
formulas:
  days_left: 'if(deadline, (deadline - today()) / 86400000, "")'
views:
  - type: table
    name: Projects
    summaries:
      note.budget: Sum
```

## Tips

- Formula properties can reference other formulas (no circular references)
- Use `file.hasTag()` and `file.inFolder()` as primary filters
- Embed bases in daily notes using `this` to create context-aware views
- Export views as CSV for spreadsheet use
- Properties edited in table view update the note's frontmatter directly
