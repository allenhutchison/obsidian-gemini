# Tool loop detection

## Overview

The Tool loop detection feature prevents the AI agent from getting stuck in infinite loops where it repeatedly calls the same tool with identical parameters. This can happen when the AI misinterprets results or gets confused about the task at hand.

## How It Works

1. **Execution Tracking**: Every tool call is recorded with its parameters and timestamp
2. **Pattern Detection**: The system checks if the same tool with identical parameters has been called multiple times within a time window
3. **Loop Prevention**: If a loop is detected, the tool execution is blocked with an error message

## Configuration

Loop detection is **always on** and is not configurable — there is no settings row for it. The
thresholds are fixed constants:

- **Loop threshold**: 3 identical calls
- **Time window**: 30 seconds

These match the defaults from earlier versions, when the feature could be tuned or disabled
under Settings → Gemini Scribe → Agent config → Tool loop detection; that section (and the
underlying `loopDetectionEnabled`/`loopDetectionThreshold`/`loopDetectionTimeWindowSeconds`
settings) was removed as part of the settings redesign.

## Example Scenario

If the AI tries to read the same file 3 times within 30 seconds:

```
1. read_file("notes/example.md") - Success
2. read_file("notes/example.md") - Success
3. read_file("notes/example.md") - Loop detected! Execution blocked
```

The AI will receive an error message:

> Execution loop detected: read_file has been called 3 times with the same parameters in the last 30 seconds. Please try a different approach.

## Per-Turn Abort

In addition to the per-tool detection above, the agent loop counts how many times loop detection fires within a single turn. If it fires three or more times in one turn (the model keeps trying near-identical calls after being blocked), the entire turn aborts cleanly with a notice: "The agent kept retrying the same tool call (loop detector fired N times). Stopping this turn to prevent a runaway loop. Try rephrasing your request or starting a new session." This prevents a model that is genuinely stuck from spinning through every tool variation. The abort is per-turn — the next user message starts fresh.

## Implementation Details

- Uses deterministic key generation for tool calls to ensure consistent detection
- Automatically cleans up old execution history to prevent memory issues
- Session-specific tracking - each agent session has its own loop detection history
- History is keyed per session ID, so a brand-new session starts with no prior detection state; loading an existing session's history does not clear it (prior detector state for that session persists)
- Per-turn abort threshold is fixed at 3 fires; the per-tool threshold and time window above are fixed constants too, not user-configurable
