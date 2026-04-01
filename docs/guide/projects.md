# Projects

Projects let you create scoped agent profiles for different areas of your vault. A project bundles custom instructions, file scope, skill selection, and permission overrides into a single configuration that automatically applies when the agent works within that project.

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
permissions:
  edit_file: allow
  delete_file: deny
---
```

## Project File Format

### Frontmatter

| Field         | Type     | Description                                              |
| ------------- | -------- | -------------------------------------------------------- |
| `tags`        | string[] | Must include `gemini-scribe/project`                     |
| `name`        | string   | Display name (defaults to file basename)                 |
| `skills`      | string[] | Skills to activate for this project (empty = all skills) |
| `permissions` | object   | Per-tool permission overrides                            |

### Permission Values

| Value   | Effect                             |
| ------- | ---------------------------------- |
| `allow` | Tool executes without confirmation |
| `deny`  | Tool is blocked entirely           |
| `ask`   | Tool requires user confirmation    |

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

### Auto-Detection

When you create a new agent session, the plugin checks if your active file is inside a project folder. If so, the session is automatically linked to that project.

### What Changes When a Project is Active

| Feature               | Behavior                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **System prompt**     | Project instructions are injected between the base prompt and tool instructions             |
| **Tool discovery**    | `list_files`, `search_files`, and `search_file_contents` scope to the project root          |
| **Read/write access** | Unrestricted — the agent can still access files outside the project when you reference them |
| **Skills**            | Only skills listed in the project's `skills` array are available (empty = all)              |
| **Permissions**       | Project permissions take priority over global presets and per-tool overrides                |

### Permission Resolution Order

1. Project-level permission (`permissions` in project frontmatter)
2. Per-tool global override (`Settings → Tool Policy → Custom`)
3. Global preset default (Cautious, Edit Mode, etc.)

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
- **Set `delete_file: deny`** in permissions for projects where you want to prevent accidental deletions
- **Project instructions stack with custom prompts** — use projects for persistent context and custom prompts for per-session behavior
