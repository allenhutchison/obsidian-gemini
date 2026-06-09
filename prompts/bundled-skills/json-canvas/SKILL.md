---
name: json-canvas
description: Create and edit Obsidian Canvas (.canvas) files — text/file/link/group nodes and the edges between them, using the JSON Canvas spec. Activate this skill when users want to build a canvas, mind map, flowchart, or visual board of notes.
---

# JSON Canvas

Obsidian Canvas files use the open [JSON Canvas](https://jsoncanvas.org) format: a `.canvas` file is plain JSON describing nodes (cards) laid out on an infinite spatial board and edges (connections) between them.

Write canvas files with the `write_file` tool — pass the full JSON as the file content with a `.canvas` extension. The plugin classifies `.canvas` as a text file, so `read_file` returns its JSON for editing. After writing, the user opens the file in Obsidian to see it rendered; remind them a `.canvas` file shows as raw JSON in a text editor but renders as a board in Canvas view.

## Top-Level Structure

```json
{
	"nodes": [],
	"edges": []
}
```

Both arrays are optional. `nodes` holds the cards; `edges` holds the connections.

## Coordinates

The canvas is an infinite 2D plane. Each node has a top-left origin (`x`, `y`) and a `width`/`height` in pixels. `x` increases rightward, `y` increases **downward**. Lay nodes out with enough spacing that they don't overlap (e.g. step `x` by `width + 100`).

## Nodes

Every node requires: `id`, `type`, `x`, `y`, `width`, `height`.

- **`id`** — a unique string. Use a 16-character lowercase hex string (e.g. `"a1b2c3d4e5f60718"`); each id must be unique within the file.
- **`color`** (optional, any node) — a preset `"1"`–`"6"` or a hex string like `"#FF0000"`.

Preset colors: `"1"` red, `"2"` orange, `"3"` yellow, `"4"` green, `"5"` cyan, `"6"` purple.

### Text node

Holds Markdown content (Obsidian Flavored Markdown is supported, including wikilinks):

```json
{
	"id": "6f0ad84f44ce9c17",
	"type": "text",
	"x": 0,
	"y": 0,
	"width": 400,
	"height": 200,
	"text": "# Hello\n\n**Bold** text and a [[Linked Note]]."
}
```

### File node

References a vault file (note, image, PDF, etc.) by path. Optional `subpath` targets a heading (`#Heading`) or block (`#^block-id`):

```json
{
	"id": "a1b2c3d4e5f67890",
	"type": "file",
	"x": 500,
	"y": 0,
	"width": 400,
	"height": 300,
	"file": "Folder/My Note.md",
	"subpath": "#Overview"
}
```

### Link node

Embeds an external URL:

```json
{
	"id": "c3d4e5f678901234",
	"type": "link",
	"x": 1000,
	"y": 0,
	"width": 400,
	"height": 200,
	"url": "https://obsidian.md"
}
```

### Group node

A labeled container drawn behind other nodes (position child nodes within its bounds). Optional `label`, `background` (image path), and `backgroundStyle` (`cover`, `ratio`, or `repeat`):

```json
{
	"id": "d4e5f6789012345a",
	"type": "group",
	"x": -50,
	"y": -50,
	"width": 1000,
	"height": 600,
	"label": "Overview"
}
```

## Edges

Edges connect two nodes. Required: `id`, `fromNode`, `toNode` (node ids). Optional:

- **`fromSide` / `toSide`** — anchor point on each node: `top`, `right`, `bottom`, `left`.
- **`fromEnd` / `toEnd`** — endpoint shape: `none` (default) or `arrow`.
- **`color`** — preset `"1"`–`"6"` or hex.
- **`label`** — text drawn on the connection.

```json
{
	"id": "0123456789abcdef",
	"fromNode": "6f0ad84f44ce9c17",
	"fromSide": "right",
	"toNode": "a1b2c3d4e5f67890",
	"toSide": "left",
	"toEnd": "arrow",
	"label": "leads to"
}
```

## Complete Example

A small flow: a text node pointing to a file node, both inside a group.

```json
{
	"nodes": [
		{
			"id": "1111111111111111",
			"type": "group",
			"x": -40,
			"y": -40,
			"width": 1040,
			"height": 320,
			"label": "Research"
		},
		{
			"id": "2222222222222222",
			"type": "text",
			"x": 0,
			"y": 0,
			"width": 400,
			"height": 240,
			"text": "## Question\n\nWhat should we build next?",
			"color": "5"
		},
		{
			"id": "3333333333333333",
			"type": "file",
			"x": 560,
			"y": 0,
			"width": 400,
			"height": 240,
			"file": "Notes/Findings.md"
		}
	],
	"edges": [
		{
			"id": "4444444444444444",
			"fromNode": "2222222222222222",
			"fromSide": "right",
			"toNode": "3333333333333333",
			"toSide": "left",
			"toEnd": "arrow",
			"label": "explores"
		}
	]
}
```

## Editing an Existing Canvas

1. `read_file` the `.canvas` file to get the current JSON.
2. Parse it, add or modify nodes/edges (keep every `id` unique), and recompute positions if you insert nodes.
3. `write_file` the full updated JSON back.

## Tips

- Always emit valid JSON — a malformed `.canvas` file fails to open in Canvas view.
- Reference vault files in file nodes by their full vault-relative path; verify the path exists (`list_files`) before pointing at it.
- Give related nodes the same `color` and wrap them in a group to convey structure.
- Space nodes generously so edges are readable; Obsidian does not auto-layout.
