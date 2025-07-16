# Tool Loop Detection

## Overview

The Tool Loop Detection feature prevents the AI agent from getting stuck in infinite loops where it repeatedly calls the same tool with identical parameters. This can happen when the AI misinterprets results or gets confused about the task at hand.

## How It Works

1. **Execution Tracking**: Every tool call is recorded with its parameters and timestamp
2. **Pattern Detection**: The system checks if the same tool with identical parameters has been called multiple times within a time window
3. **Loop Prevention**: If a loop is detected, the tool execution is blocked with an error message

## Configuration

Loop detection can be configured in Settings > Developer Settings > Tool Loop Detection:

- **Enable loop detection**: Toggle the feature on/off
- **Loop threshold**: Number of identical calls before considering it a loop (default: 3)
- **Time window**: Time period in seconds to check for repeated calls (default: 30 seconds)

## Example Scenario

If the AI tries to read the same file 3 times within 30 seconds:
```
1. read_file("notes/example.md") - Success
2. read_file("notes/example.md") - Success  
3. read_file("notes/example.md") - Loop detected! Execution blocked
```

The AI will receive an error message:
> Execution loop detected: read_file has been called 3 times with the same parameters in the last 30 seconds. Please try a different approach.

## Implementation Details

- Uses deterministic key generation for tool calls to ensure consistent detection
- Automatically cleans up old execution history to prevent memory issues  
- Session-specific tracking - each agent session has its own loop detection history
- History is cleared when creating new sessions or loading from history