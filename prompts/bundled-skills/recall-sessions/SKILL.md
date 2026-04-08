---
name: recall-sessions
description: Search past agent conversations to recall prior discussions, decisions, and context. Activate this skill when users ask about previous conversations, want to resume past work, or reference earlier decisions.
---

# Recall Past Sessions

Find and retrieve past agent conversations using the `recall_sessions` tool. This enables recalling prior discussions, decisions, and context from earlier sessions.

## When to Use

Use this skill when the user:

- Asks "what did we discuss about..." or "last time we talked about..."
- Wants to resume or continue previous work
- References a decision or conversation from a past session
- Asks "have we worked on..." or "do you remember when..."
- Needs context from a prior session about a specific file or project

## How to Use

Call the `recall_sessions` tool with these parameters:

- **`query`** (optional) — Search term to match against session titles (case-insensitive substring match).
- **`filePath`** (optional) — Find sessions that accessed a specific file (e.g., `notes/meeting.md`).
- **`project`** (optional) — Find sessions linked to a specific project name.
- **`limit`** (optional) — Maximum results to return. Default is 10, maximum is 50.

At least one of `query`, `filePath`, or `project` should be provided for meaningful results.

## Search Strategies

- **Topic search** — Use `query` when the user asks about a discussion topic: `recall_sessions(query="refactoring")`
- **File-based recall** — Use `filePath` when the user references a specific file: `recall_sessions(filePath="projects/website-redesign.md")`
- **Project recall** — Use `project` when the user mentions a project: `recall_sessions(project="website-redesign")`
- **Combined search** — Use multiple parameters to narrow results: `recall_sessions(query="API design", project="backend")`

## Progressive Disclosure

The tool returns **session summaries only** — title, date, files accessed, project linkage, and a `historyPath`.

To see the full conversation from a past session, use `read_file` on the returned `historyPath`. This two-step approach avoids loading unnecessary conversation data.

### Workflow

1. Call `recall_sessions` to find relevant sessions
2. Review the returned summaries with the user
3. Use `read_file` on the `historyPath` of the session(s) the user is interested in
4. Summarize or reference the relevant parts of the conversation

## Tips

- Results are sorted by most recent first — the newest sessions appear at the top.
- The current session is automatically excluded from results.
- When the user asks a vague question like "what did we do last time", try a broad `query` or search by the files currently in context using `filePath`.
- If no results are found, let the user know and suggest alternative search terms or parameters.
