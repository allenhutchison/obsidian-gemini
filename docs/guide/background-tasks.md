# Background Tasks

Long-running operations — deep research and image generation — run in the background so they never block your editing session. Results are saved to your vault automatically and you're notified when they're ready.

## Status Bar Indicator

The status bar shows a single indicator for all background work. It reflects both active background tasks and the RAG indexing state in one place.

| Appearance                     | Meaning                                          |
| ------------------------------ | ------------------------------------------------ |
| Hidden                         | No background work running, RAG idle or disabled |
| Spinning loader icon + count   | One or more background tasks running             |
| Upload-cloud icon + percentage | RAG indexing in progress                         |
| Database icon + number         | RAG idle, N files indexed                        |

Click the indicator at any time to open the **Background Tasks** panel.

## Background Tasks Panel

The panel (also available via **Command Palette → View Background Tasks**) shows:

- **Running** — tasks currently in progress, with a Cancel button for each
- **Recent** — the last 20 completed, failed, or cancelled tasks

Completed tasks with output files show an **Open result** link that opens the file in Obsidian.

## How Tasks Are Created

Background tasks are created automatically when you trigger long-running operations:

- **Deep Research** — starts a research task; result saved to `<history-folder>/background-tasks/<id>.md`
- **Image Generation** — generates and saves an image; result path shown in the completion notice

Both operations fire a completion notice with a clickable vault link when done. If a task fails, a notice explains the error.

## Cancellation

Click **Cancel** next to a running task in the panel. The task stops at the next safe checkpoint — it may not stop instantly if the underlying API call is already in flight.

## Accessing Results

When a task completes you'll see a notice in the bottom-right corner with an **Open result** link. You can also find the result by:

1. Clicking the status bar indicator → **Open result** in the Recent section
2. Navigating directly to `<history-folder>/background-tasks/` in the file explorer

## Troubleshooting

**Task shows as failed**
Check the error shown in the Background Tasks panel. Common causes:

- API key not configured or expired
- Network timeout on long-running research queries
- Vault path conflict for image output

**Status bar indicator not visible**
The indicator is hidden when there is nothing to show (no tasks running, RAG disabled or idle). Trigger a background task or enable RAG indexing in Settings.
