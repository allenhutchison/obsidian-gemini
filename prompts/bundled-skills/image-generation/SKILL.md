---
name: image-generation
description: Generate images from text descriptions and save them to the vault. Activate this skill when users want to create illustrations, diagrams, visual content, or any AI-generated images.
---

# Image Generation

Generate images from text descriptions using the `generate_image` tool and embed them in vault notes.

## How to Use

Call the `generate_image` tool with these parameters:

- **`prompt`** (required) — A detailed text description of the image to generate.
- **`target_note`** (optional) — Path to a note that determines which attachment folder the image is saved to. If omitted, the currently active note is used.

### Critical Two-Step Workflow

The `generate_image` tool **only generates and saves the image file** — it does NOT insert the image into any note. To embed the image in a note:

1. Call `generate_image` with your prompt
2. Use the returned `wikilink` (e.g., `![[generated-image.png]]`) and insert it into the target note with `write_file`

Always complete both steps when the user wants an image in a specific note.

## Prompt Engineering Tips

Write detailed, specific prompts for the best results:

- **Be descriptive** — "A serene mountain lake at sunset with snow-capped peaks reflected in still water" is much better than "a lake"
- **Specify style** — Include keywords like: photorealistic, watercolor, minimalist, sketch, oil painting, digital art, flat illustration, isometric
- **Include composition** — Mention perspective: close-up, wide angle, aerial view, eye-level, birds-eye view
- **Set the mood** — Describe lighting and atmosphere: warm golden hour light, dramatic shadows, soft diffused lighting, moody fog
- **State what to avoid** — If certain elements shouldn't appear, mention that in the prompt

### Example Prompts

- "A minimalist flat illustration of a bookshelf filled with colorful books, soft pastel colors, clean lines, white background"
- "Photorealistic close-up of a mechanical keyboard with cherry blossom keycaps, shallow depth of field, warm desk lamp lighting"
- "Watercolor painting of a cozy reading nook with an armchair, stack of books, and a steaming cup of tea, warm autumn tones"

## Common Use Cases

- **Note illustrations** — Visual headers or concept diagrams for notes
- **Creative projects** — Story illustrations, mood boards, concept art
- **Blog and presentation images** — Custom visuals for published content
- **Visual thinking** — Generating images to explore ideas or concepts

## Tips

- Use `target_note` when the user specifies which note should contain the image — this ensures the file is saved to the correct attachment folder per the user's Obsidian settings.
- If the user asks for multiple images, generate them one at a time and confirm each result before proceeding.
- When the user gives a vague request like "add an image to my note", ask what they'd like the image to depict before generating.
