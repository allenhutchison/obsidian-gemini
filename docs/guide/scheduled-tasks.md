# Scheduled Tasks

Scheduled Tasks let you automate recurring AI prompts — daily summaries, weekly reports, periodic vault maintenance — without any manual intervention. Each task runs as a headless agent session and writes its output to a file in your vault.

## Overview

A scheduled task is a markdown file stored in `<history-folder>/Scheduled-Tasks/`. The file's frontmatter controls when and how it runs; the body is the prompt sent to the model.

```text
gemini-scribe/Scheduled-Tasks/
├── daily-summary.md          ← task definition (you create and edit this)
├── Runs/
│   └── daily-summary/
│       └── 2026-04-18.md    ← output from each run
└── scheduled-tasks-state.json  ← runtime state (managed automatically)
```

## Creating a Task

> **Note:** A task creation UI (command palette → "New Scheduled Task") is planned for a follow-up release. For now, create task files manually as described below.

Create a markdown file inside `<history-folder>/Scheduled-Tasks/`. The filename (without `.md`) becomes the task's **slug** — used in output paths and the task monitor.

**Minimal example** — `gemini-scribe/Scheduled-Tasks/daily-summary.md`:

```markdown
---
schedule: daily
enabledTools:
  - read_only
---

Summarise the notes I created or modified today. List the key topics and any open questions.
```

### Frontmatter Fields

| Field          | Required | Default                                                  | Description                                                                 |
| -------------- | -------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `schedule`     | Yes      | —                                                        | When to run. See [Schedule Formats](#schedule-formats) below.               |
| `enabledTools` | No       | `[]` (read-only)                                         | List of tool categories the agent may use. See [Tool Access](#tool-access). |
| `outputPath`   | No       | `<history-folder>/Scheduled-Tasks/Runs/<slug>/{date}.md` | Where to write results. Supports `{slug}` and `{date}` placeholders.        |
| `model`        | No       | Plugin chat model                                        | Override the model for this task (e.g. `gemini-2.0-flash`).                 |
| `enabled`      | No       | `true`                                                   | Set to `false` to disable the task without deleting it.                     |
| `runIfMissed`  | No       | `false`                                                  | Reserved for future use — catch-up runs are not yet implemented.            |

### Schedule Formats

| Value         | Runs…                                 |
| ------------- | ------------------------------------- |
| `once`        | Exactly once, then stops              |
| `daily`       | Every 24 hours                        |
| `weekly`      | Every 7 days                          |
| `interval:Xm` | Every X minutes (e.g. `interval:30m`) |
| `interval:Xh` | Every X hours (e.g. `interval:2h`)    |

### Tool Access

The `enabledTools` list controls what the agent can do during a run:

| Category      | Capabilities                         |
| ------------- | ------------------------------------ |
| `read_only`   | Read files, list files, search vault |
| `read_write`  | Read + write, create, move files     |
| `destructive` | Read + write + delete files          |

If `enabledTools` is empty the task defaults to `read_only`.

## Viewing Task Status

Open **Command Palette → View Scheduled Tasks** to see all tasks with:

- Next scheduled run time
- Last run time
- Last error (if any)
- Status badge (`disabled`, `paused`, or schedule string)

From this panel you can also **Run now** to trigger a task immediately, or **Reset** a task that has been paused after repeated failures.

## Output Files

Each run writes a file to the resolved `outputPath`. The file includes a frontmatter header:

```markdown
---
scheduled_task: 'daily-summary'
ran_at: '2026-04-18T08:00:00.000Z'
---

<model response here>
```

The `{date}` placeholder in `outputPath` is replaced with the local date (`YYYY-MM-DD`), so each run produces a separate file by default.

## Error Handling and Pausing

If a task fails **3 consecutive times**, the scheduler automatically pauses it to prevent runaway retries. The task monitor shows it with a `paused` badge and displays the last error.

To resume a paused task:

1. Open **Command Palette → View Scheduled Tasks**
2. Fix the underlying issue (e.g. invalid prompt, missing API key)
3. Click **Reset** next to the paused task

## Scheduler Timing

The scheduler checks for due tasks every **60 seconds**. Task files created while Obsidian is running are discovered immediately via a vault file-creation listener. Files that exist when the plugin loads are discovered on startup — if Obsidian's metadata cache hasn't finished indexing at that point, a task may be missed until the next plugin reload. This is a known startup race and will be addressed in a follow-up.

A task is considered due when the current time is at or past its `nextRunAt` value stored in `scheduled-tasks-state.json`. The first run of a newly discovered task is triggered immediately on the next tick.

## Tips

- **Keep prompts focused** — scheduled tasks run without streaming UI, so concise prompts produce more reliable outputs.
- **Use `read_only` unless you need writes** — minimises the risk of unintended vault modifications.
- **Set `enabled: false`** to pause a task temporarily without losing its schedule state.
- **Use `once`** for one-off automation (e.g. a migration script) — the task becomes a no-op after its first run.
