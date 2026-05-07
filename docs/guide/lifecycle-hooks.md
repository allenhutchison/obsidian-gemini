# Lifecycle Hooks

Lifecycle Hooks let you trigger an AI agent run in response to Obsidian vault events — file created, modified, deleted, or renamed. Each hook runs as a headless agent session, the same execution model used by Scheduled Tasks. A hook can summarise notes on save, run a skill when a file is created, or perform any other agent task without manual intervention.

::: warning Opt-in
Hooks are disabled by default. Set **Enable lifecycle hooks** in plugin settings before any hook will fire. The default is off because vault events fire continuously and an unintentionally-broad hook can drain API quota quickly.
:::

## Overview

A hook is a markdown file stored in `<history-folder>/Hooks/`. The file's frontmatter controls the trigger, filter, and action; the body is the prompt template.

```text
gemini-scribe/Hooks/
├── summarise-on-save.md     ← hook definition (you create and edit this)
├── Runs/
│   └── summarise-on-save/
│       └── 2026-05-04.md    ← output from each fire (when outputPath is set)
└── hooks-state.json         ← runtime state (managed automatically)
```

## Enabling Hooks

1. Open Settings → General → Lifecycle Hooks
2. Toggle **Enable lifecycle hooks**

When the toggle is on the plugin creates the `Hooks/` folder, subscribes to vault events, and starts dispatching matching events to your hook definitions.

## Creating a Hook

The fastest path is the **Hook Manager** modal. Two ways to open it:

- Settings → General → Lifecycle Hooks → **Open Hook Manager**
- Command palette → **Gemini Scribe: Open Hook Manager** (or **New Lifecycle Hook** to skip straight to the create form)

The modal has a list view (toggle / edit / delete / reset on each row) and a create/edit form covering trigger, path glob, tool access, prompt, plus an Advanced section for debounce, cooldown, rate limit, model override, output path, and the desktop-only flag.

You can also create hooks by hand-editing markdown files inside `<history-folder>/Hooks/`. The filename (without `.md`) becomes the hook's **slug**.

**Minimal example** — `gemini-scribe/Hooks/summarise-on-save.md`:

```markdown
---
trigger: file-modified
pathGlob: 'Daily/**/*.md'
debounceMs: 5000
maxRunsPerHour: 12
action: agent-task
enabledTools:
  - read_only
outputPath: 'Hooks/Runs/summarise-on-save/{date}.md'
---

The user just saved {{filePath}}. Read it and write a one-paragraph summary highlighting any open questions or action items.
```

### Frontmatter Fields

| Field               | Required               | Default                   | Description                                                                                                                                                                      |
| ------------------- | ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trigger`           | Yes                    | —                         | Vault event. One of: `file-created`, `file-modified`, `file-deleted`, `file-renamed`.                                                                                            |
| `action`            | Yes                    | —                         | What to do on each fire. One of: `agent-task`, `summarize`, `rewrite`, `command`. See [Actions](#actions) below.                                                                 |
| `commandId`         | When `action: command` | —                         | Command palette id to dispatch (e.g. `editor:save-file`).                                                                                                                        |
| `focusFile`         | No                     | `false`                   | When `action: command`, focus the triggering file in the workspace before dispatching so editor-scoped commands target it. Off by default — see [Actions → `command`](#command). |
| `pathGlob`          | No                     | (matches all paths)       | Glob pattern matched against the triggering file's vault path. Supports `*` and `**`.                                                                                            |
| `frontmatterFilter` | No                     | —                         | Object of key/value pairs the note's frontmatter must match for the hook to fire.                                                                                                |
| `debounceMs`        | No                     | `5000`                    | Per-(hook, file) debounce window in milliseconds. Coalesces rapid saves into one fire.                                                                                           |
| `maxRunsPerHour`    | No                     | unlimited                 | Sliding-window rate limit per hook (across all files).                                                                                                                           |
| `cooldownMs`        | No                     | `30000`                   | After a fire completes, suppress further events on the same (hook, file) for this window. Prevents self-retrigger.                                                               |
| `enabledTools`      | No                     | `['read_only', 'skills']` | Tool categories the agent may use during the run.                                                                                                                                |
| `enabledSkills`     | No                     | `[]`                      | Skill slugs to pre-activate in the headless session.                                                                                                                             |
| `model`             | No                     | Plugin chat model         | Override the model for this hook (e.g. `gemini-2.5-flash-lite`).                                                                                                                 |
| `outputPath`        | No                     | (no file written)         | Where to write the agent's final response. Supports `{slug}`, `{date}`, and `{fileName}` placeholders.                                                                           |
| `enabled`           | No                     | `true`                    | Set to `false` to disable the hook without deleting it.                                                                                                                          |
| `desktopOnly`       | No                     | `true`                    | When `true` the hook is skipped on mobile. Headless agent runs can be heavyweight on phones.                                                                                     |

### Prompt Template Variables

The body of the hook file is a prompt template. The following placeholders are substituted before the prompt is sent to the model:

| Placeholder    | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| `{{filePath}}` | Vault path of the triggering file (the new path on rename). |
| `{{fileName}}` | File name including extension.                              |
| `{{trigger}}`  | The trigger that fired (e.g. `file-modified`).              |
| `{{oldPath}}`  | Previous path on `file-renamed`; empty otherwise.           |

## Actions

Each hook does one of four things on fire. The form's **Action** dropdown switches the visible inputs to match.

### `agent-task` (default)

Run a headless agent session with the prompt body as the instruction. Honours `enabledTools`, `enabledSkills`, `model`, and writes the model's final response to `outputPath` if configured. This is the most flexible action — the agent can call tools, read other files, run skills, etc.

### `summarize`

Run the existing **Summarize Active File** feature against the triggering file, but without needing it to be active. The summary is written into the file's frontmatter under the `summary` key (configurable via `summaryFrontmatterKey` in plugin settings). The prompt body is ignored. Non-markdown triggers are silently skipped so a broad `pathGlob` that catches images doesn't pollute the failure counter.

### `rewrite`

Run a full-file rewrite using the prompt body as the rewrite instruction. The triggering file's content is sent to the model with the instruction; the model's response replaces the file. Template variables in the prompt body are substituted before sending — e.g. `Style this {{fileName}} as terse meeting notes.` Non-markdown triggers are silently skipped.

### `command`

Execute a registered command palette command by id. The hook frontmatter must include `commandId:` (e.g. `editor:save-file`, `gemini-scribe-summarize-active-file`); the prompt body is ignored. If the command id is unknown, the hook records a failure rather than silently no-op.

**Active file vs. trigger file.** Obsidian's command API (`app.commands.executeCommandById`) always runs the command against whatever workspace state is currently active — there's no way to scope a single dispatch to a specific file. By default a hook just dispatches; if your trigger file is already focused (typical for `file-modified`), an editor-scoped command like `editor:save-file` will act on it. If you can't rely on that, opt in to `focusFile: true`:

```yaml
---
trigger: file-modified
action: command
commandId: editor:save-file
focusFile: true
---
```

With `focusFile: true`, the runner calls `app.workspace.openLinkText(filePath, '', false)` before dispatching, so the trigger file is the active editor when the command runs. If the trigger file is gone (e.g. a `file-deleted` trigger), the dispatch is skipped with a log entry. The flag is opt-in because focusing the file changes the user's view — disruptive on every fire of a global command (`app:reload`, `theme:toggle`, etc.) where the active file is irrelevant.

## Safety Features

Hooks fire reactively and can run continuously, so the engine has several guardrails to keep API costs and runaway loops in check.

### Always-Excluded Paths

Two folders never trigger hooks regardless of glob:

- The plugin state folder (`<history-folder>/`)
- Obsidian's own configuration folder (`.obsidian/`)

This prevents trivial loops where a hook's own output (in `Hooks/Runs/...`) would re-trigger it.

### Debounce

Each `(hook, file)` pair has its own debounce timer. Rapid saves while typing are coalesced into a single fire after `debounceMs` of quiet. Default is 5 seconds.

### Per-Hour Rate Limit

`maxRunsPerHour` enforces a sliding-window cap on how many times a single hook can fire per hour. Reached the cap? Further events are dropped with a log entry until the window slides forward.

### Cooldown After Fire

After a hook completes its agent run, further events on the same `(hook, file)` are suppressed for `cooldownMs` (default 30 s). This is the primary loop prevention: if your hook writes to the same file that triggered it, the resulting `modify` event won't re-trigger the hook.

### Hard Loop Ceiling

If a single hook fires 5+ times within 60 seconds (regardless of file), the engine **auto-pauses** the hook with `pausedDueToErrors: true` in the state file and surfaces a notice. Edit the state file or delete it to resume.

### Auto-Pause on Repeated Failure

After three consecutive errors, a hook is auto-paused. Inspect `<history-folder>/Hooks/hooks-state.json` to see the last error message and clear the `pausedDueToErrors` flag to resume.

## Examples

### Summarise daily notes on save

```markdown
---
trigger: file-modified
pathGlob: 'Daily/**/*.md'
debounceMs: 10000
maxRunsPerHour: 6
action: agent-task
enabledTools:
  - read_only
outputPath: 'Hooks/Runs/daily-summary/{fileName}'
---

Read the daily note at {{filePath}}. Append a brief summary of the day's main topics to its frontmatter under a `summary:` key. If the note already has a summary, replace it.
```

### Index new attachments

```markdown
---
trigger: file-created
pathGlob: 'Attachments/**'
action: agent-task
enabledTools:
  - read_only
  - read_write
---

A new file was just added at {{filePath}}. Read it (if it's text-based), generate a short description, and append a row to `Attachments/index.md` with the file path and description.
```

### Run a specific skill on certain notes

```markdown
---
trigger: file-modified
frontmatterFilter:
  type: meeting-notes
debounceMs: 30000
action: agent-task
enabledSkills:
  - meeting-extractor
---

The user updated meeting notes at {{filePath}}. Use the meeting-extractor skill to extract action items and add them to the user's task list.
```

### Auto-summarize on save

```markdown
---
trigger: file-modified
pathGlob: 'Articles/**/*.md'
debounceMs: 30000
maxRunsPerHour: 6
action: summarize
---
```

The body is ignored — the summarize action calls the existing summary feature against the triggering file and writes the result into its frontmatter.

### Reformat drafts on save

```markdown
---
trigger: file-modified
pathGlob: 'Drafts/**/*.md'
debounceMs: 60000
action: rewrite
---

Tighten the prose in {{fileName}}: remove filler words, hedging, and passive voice. Preserve all headings, links, and code blocks.
```

### Run a command against the trigger file

```markdown
---
trigger: file-created
pathGlob: 'Inbox/**/*.md'
action: command
commandId: gemini-scribe-summarize-active-file
focusFile: true
---
```

When a new file lands in `Inbox/`, focus it in the workspace and run the **Summarize Active File** command against it. `focusFile: true` is the bit that ensures the command targets the trigger file rather than whatever the user happens to be looking at.

## Limitations

- Hooks only fire while Obsidian is running. There's no catch-up for events missed while the app was closed (vault events don't have a "missed run" concept).
- Workspace and editor events (`file-open`, active leaf change, editor changes) are not supported — they fire too noisily and the AI features that respond to typing already exist via Completions.
- The management UI doesn't currently include a frontmatter-filter editor — set the `frontmatterFilter:` block by hand-editing the hook's markdown file.
- A hook that triggers another hook (chained fires) is supported but not encouraged. Use one hook with a multi-step prompt instead.

## Related

- [Scheduled Tasks](/guide/scheduled-tasks) — for time-based automation
- [Background Tasks](/guide/background-tasks) — runtime model for long-running operations
- [Agent Skills](/guide/agent-skills) — skills that hooks can pre-activate
