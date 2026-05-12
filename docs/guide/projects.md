# Projects

Projects let you create scoped agent profiles for different areas of your vault. A project bundles custom instructions, file scope, skill selection, and permission overrides into a single configuration that automatically applies when the agent works within that project.

> **Blog Post:** [Scoping AI Context with Projects in Gemini Scribe](https://allen.hutchison.org/2026/04/09/scoping-ai-context-with-projects-in-gemini-scribe/) — a walkthrough of why projects exist and how to use them effectively.

## What is a Project?

A project is any Markdown file in your vault with the `gemini-scribe/project` tag in its frontmatter. The file's **parent directory becomes the project root** — the agent's discovery scope when the project is active.

The file body contains instructions that are injected into the agent's system prompt, and wikilinks/embeds reference external context files.

## Creating a Project

### From the Command Palette

1. Open the command palette (`Ctrl/Cmd + P`)
2. Search for **"Create Project"**
3. A new project file is created in the current folder with template frontmatter
4. Edit the file to customize your project

### Converting an Existing Note

1. Open the note you want to convert
2. Open the command palette
3. Search for **"Convert Note to Project"**
4. The `gemini-scribe/project` tag is added to the note's frontmatter

### Manual Creation

Create any Markdown file with this frontmatter:

```yaml
---
tags:
  - gemini-scribe/project
name: My Project
skills:
  - writing-coach
  - continuity-tracker
toolPolicy:
  preset: edit_mode
  overrides:
    delete_file: deny
---
```

## Project File Format

### Frontmatter

| Field        | Type     | Description                                                                           |
| ------------ | -------- | ------------------------------------------------------------------------------------- |
| `tags`       | string[] | Must include `gemini-scribe/project`                                                  |
| `name`       | string   | Display name (defaults to file basename)                                              |
| `skills`     | string[] | Skills to activate for this project (empty = all skills)                              |
| `toolPolicy` | object   | Project-scoped tool policy. Omit to inherit the global plugin tool policy. See below. |

### Tool Policy

The `toolPolicy` block lets a project narrow or open the agent's tool surface for any session linked to the project. It has the same shape every other policy-bearing feature uses (scheduled tasks, hooks, sessions):

```yaml
toolPolicy:
  preset: read_only # one of: read_only, cautious, edit_mode, yolo
  overrides: # optional per-tool overrides (most specific wins)
    write_file: allow
    delete_file: deny
```

- `preset` chooses the baseline permission for every tool by classification (READ / WRITE / DESTRUCTIVE / EXTERNAL). Omit to inherit the global plugin preset.
- `overrides` maps individual tool names to a permission; entries here win over both the project preset and the global policy's per-tool overrides.
- An omitted `toolPolicy` block means "inherit the global plugin tool policy entirely."

#### Permission Values

| Value   | Effect                             |
| ------- | ---------------------------------- |
| `allow` | Tool executes without confirmation |
| `deny`  | Tool is blocked entirely           |
| `ask`   | Tool requires user confirmation    |

> **Legacy note** — the older `permissions: { tool: 'allow' }` frontmatter map still loads. The first time the plugin reads such a file it rewrites the frontmatter into the new `toolPolicy.overrides` shape.

### Body Text

Everything after the frontmatter is injected as **project instructions** into the agent's system prompt. Write your instructions in plain Markdown:

```markdown
---
tags:
  - gemini-scribe/project
name: My Novel
---

You are a creative writing assistant helping me write a fantasy novel.
Always maintain consistency with the established magic system.
Use third-person limited POV from the protagonist's perspective.

## Additional Context

- [[Reference/Style Guide]]
- ![[World Building/Magic System]]
```

- **Wikilinks** (`[[file]]`) and **embeds** (`![[file]]`) are resolved as context references
- **Dataview/Bases code blocks** are automatically stripped (not sent to the model)
- All other Markdown content is passed through as-is

## How Projects Work

### Project is a Property of the Session

Once a session is linked to a project, that linkage is **stable for the lifetime of the session**. Moving between files in your workspace, opening notes outside the project folder, or navigating to unrelated files does **not** change which project the session is using. In normal use, the project only changes when you explicitly switch it via the "Switch Project" action in the agent view header menu or the command palette.

This means:

- Project instructions are applied consistently to every message in the session, regardless of which file is currently focused in the editor
- You can reference files from anywhere in your vault while keeping the project's instructions and scope active
- If you want a different project, create a new session or explicitly switch projects — the plugin won't silently change contexts on you as you navigate

**Exception: deleted project files.** When a session is loaded, the plugin verifies that its linked project file still exists. If the project file has been deleted or moved since the session was last used, the session is automatically unlinked so it falls back to vault-wide scope. You can re-link it via "Switch Project" once you recreate or locate the project file.

### Auto-Detection

When you create a **new** agent session, the plugin inspects the session's initial context files — the files added automatically at session creation. If any of those files live inside a project folder, the session is linked to that project. This detection happens once, at session creation time, and runs in the `sessionCreated` event handler ([`project-activation-subscriber.ts`](https://github.com/allenhutchison/obsidian-gemini/blob/master/src/subscribers/project-activation-subscriber.ts)). After that, the linkage is fixed until you explicitly change it (or the project file is removed — see the exception above).

### What Changes When a Project is Active

| Feature               | Behavior                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **System prompt**     | Project instructions are injected between the base prompt and tool instructions             |
| **Tool discovery**    | `list_files`, `find_files_by_name`, and `find_files_by_content` scope to the project root   |
| **Read/write access** | Unrestricted — the agent can still access files outside the project when you reference them |
| **Skills**            | Only skills listed in the project's `skills` array are available (empty = all)              |
| **Tool policy**       | The project's `toolPolicy` is layered on top of the global plugin tool policy               |

### Tool Policy Resolution Order

1. Project `toolPolicy.overrides[toolName]`
2. Global per-tool override (`Settings → Tool Policy → Custom`)
3. Project `toolPolicy.preset` (if set)
4. Global preset default (Cautious, Edit Mode, etc.)

## Managing Projects

### Switching Projects

Click the **project badge** in the agent session header to open the project picker. You can also use the **"Switch Project"** command from the command palette.

Select **"No Project"** to unlink the session from any project and return to vault-wide scope.

### Opening Project Settings

Use the **"Open Project Settings"** command to open the project file for editing. If you have multiple projects, a picker is shown.

### Resuming a Project Session

Use the **"Resume Project Session"** command to pick a project and load its most recent agent session.

### Removing a Project

Open the project file and use the **"Remove Project"** command to strip the `gemini-scribe/project` tag. The file remains in your vault — only its project status is removed.

## Tips

- **Keep project files at the root of the relevant folder** — the parent directory becomes the scope boundary
- **Use wikilinks in the body** to reference files outside the project that the agent should know about
- **Start with an empty `skills` array** to allow all skills, then narrow down as needed
- **Set `delete_file: deny`** under `toolPolicy.overrides` for projects where you want to prevent accidental deletions
- **Project instructions stack with custom prompts** — use projects for persistent context and custom prompts for per-session behavior
