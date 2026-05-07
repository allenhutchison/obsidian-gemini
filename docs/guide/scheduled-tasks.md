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

The easiest way to create a task is through the **Scheduler** UI:

1. Open the command palette and run **Open Scheduler** (or go to Settings → Gemini Scribe → Automation → **Open Scheduler**)
2. Click **New task**
3. Fill in the slug, schedule, tool access, and prompt
4. Click **Create task**

You can also create tasks manually by writing a markdown file directly:

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

| Field          | Required | Default                                                  | Description                                                                                                                              |
| -------------- | -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule`     | Yes      | —                                                        | When to run. See [Schedule Formats](#schedule-formats) below.                                                                            |
| `enabledTools` | No       | `['read_only', 'skills']`                                | List of tool categories the agent may use. See [Tool Access](#tool-access). Omitting the field or setting `[]` resolves to this default. |
| `outputPath`   | No       | `<history-folder>/Scheduled-Tasks/Runs/<slug>/{date}.md` | Where to write results. Supports `{slug}` and `{date}` placeholders.                                                                     |
| `model`        | No       | Plugin chat model                                        | Override the model for this task (e.g. `gemini-flash-latest`).                                                                           |
| `enabled`      | No       | `true`                                                   | Set to `false` to disable the task without deleting it.                                                                                  |
| `runIfMissed`  | No       | `false`                                                  | When `true`, tasks missed while Obsidian was closed are caught up on the next startup. See [Catch-up Runs](#catch-up-runs).              |

### Schedule Formats

| Value               | Runs…                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `once`              | Exactly once, then stops                                                                                          |
| `daily`             | Every 24 hours from when the task was created                                                                     |
| `daily@HH:MM`       | Every day at the given local time (24-hour). Example: `daily@16:30` for 4:30 PM                                   |
| `weekly`            | Every 7 days from when the task was created                                                                       |
| `weekly@HH:MM:DAYS` | At the given local time on the listed weekdays. `DAYS` is a comma-separated list of `sun,mon,tue,wed,thu,fri,sat` |
| `interval:Xm`       | Every X minutes (e.g. `interval:30m`)                                                                             |
| `interval:Xh`       | Every X hours (e.g. `interval:2h`)                                                                                |

`HH:MM` is 24-hour and uses your local timezone. The scheduler ticks once a minute, so a task scheduled for 16:30 may fire any time between 16:30:00 and 16:30:59. Daylight saving transitions follow JavaScript `Date` semantics — on the spring-forward day, a `daily@02:30` slot may shift by one hour.

**Example — run a daily summary every weekday at 4:30 PM:**

```markdown
---
schedule: weekly@16:30:mon,tue,wed,thu,fri
enabledTools:
  - read_only
---

Summarise the notes I created or modified today.
```

### Tool Access

The `enabledTools` list controls what the agent can do during a run:

| Category       | Capabilities                                           |
| -------------- | ------------------------------------------------------ |
| `read_only`    | Read files, list files, search vault, web search/fetch |
| `vault_ops`    | Create, modify, move, and delete files in the vault    |
| `external_mcp` | Tools provided by connected MCP servers                |
| `skills`       | Load and activate agent skills                         |

Categories are additive — list as many as the task needs. If `enabledTools` is empty the task defaults to `read_only` + `skills`, so common patterns like "run skill X on a schedule" work without extra setup. Set `enabledTools: ['read_only']` explicitly if you want a stricter allowlist that omits skill tools.

## Managing Tasks

### Open Scheduler

The **Scheduler** modal is the primary way to manage your tasks. Open it from:

- Command palette → **Open Scheduler**
- Settings → Gemini Scribe → Automation → **Open Scheduler**

From the Scheduler you can:

| Action                                  | How                             |
| --------------------------------------- | ------------------------------- |
| View all tasks with next/last run times | Task list                       |
| Create a new task                       | Click **New task**              |
| Edit an existing task                   | Click **Edit** on any row       |
| Enable or disable a task                | Click **Disable** / **Enable**  |
| Trigger an immediate run                | Click **Run now**               |
| Reset a paused task                     | Click **Reset** on a paused row |
| Delete a task                           | Click **Delete**                |

### Create a New Task via Command

You can also open the create form directly: **Command Palette → New Scheduled Task**.

### Read-Only Status View

For a lightweight read-only summary, use **Command Palette → View Scheduled Tasks**. This panel shows the same task list without edit controls.

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

1. Open **Command Palette → Open Scheduler**
2. Fix the underlying issue (e.g. invalid prompt, missing API key)
3. Click **Reset** next to the paused task

## Catch-up Runs

When Obsidian is closed, scheduled tasks cannot run. Set `runIfMissed: true` in a task's frontmatter to have it caught up automatically the next time Obsidian starts.

On startup, the plugin compares each task's `nextRunAt` against the current time. Any task with `runIfMissed: true` that is overdue (and not paused) is treated as a missed run. By default, a red `!` badge appears on the background-tasks status bar item — click it to open the **Missed Scheduled Runs** modal, which lists each missed task with **Run** and **Skip** buttons. On mobile (where the status bar is hidden), the modal opens automatically on startup instead of waiting for a badge click.

- **Run** — submits the task immediately as a background task
- **Skip** — advances the schedule without running
- **Run all / Skip all** — bulk actions for all listed tasks

Dismissing the modal (Escape or ✕) leaves the `!` badge in place so you can reopen the modal later by clicking the badge.

### Auto-run on startup

Enable **Settings → Gemini Scribe → Automation → Auto-run missed scheduled tasks on startup** to skip the approval modal entirely and submit all missed tasks silently on every startup.

### Notes

- Only tasks with `runIfMissed: true` and `enabled: true` are included; tasks paused due to repeated failures are excluded.
- Only one catch-up run is submitted per task per startup, regardless of how many intervals were missed.
- Tasks missed more than 7 days ago are considered stale and excluded.

## Scheduler Timing

The scheduler checks for due tasks every **60 seconds**. Task files created while Obsidian is running are discovered immediately via a vault file-creation listener. Files that exist when the plugin loads are discovered on startup.

A task is considered due when the current time is at or past its `nextRunAt` value stored in `scheduled-tasks-state.json`. The first run of a newly discovered task is triggered immediately on the next tick.

## Tips

- **Keep prompts focused** — scheduled tasks run without streaming UI, so concise prompts produce more reliable outputs.
- **Use `read_only` unless you need writes** — minimises the risk of unintended vault modifications.
- **Set `enabled: false`** to pause a task temporarily without losing its schedule state.
- **Use `once`** for one-off automation (e.g. a migration script) — the task becomes a no-op after its first run.
