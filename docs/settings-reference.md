# Settings Reference

This document provides a comprehensive reference for all Obsidian Gemini Scribe settings in v4.0.0.

## Table of Contents
- [Basic Settings](#basic-settings)
- [Model Configuration](#model-configuration)
- [Custom Prompts](#custom-prompts)
- [UI Settings](#ui-settings)
- [Developer Settings](#developer-settings)
- [Session-Level Settings](#session-level-settings)

## Basic Settings

### API Key
- **Setting**: `apiKey`
- **Type**: String
- **Required**: Yes
- **Description**: Your Google AI API key for accessing Gemini models
- **How to obtain**: Visit [Google AI Studio](https://aistudio.google.com/apikey)

### Your Name
- **Setting**: `userName`
- **Type**: String
- **Default**: `"User"`
- **Description**: Name used by the AI when addressing you in responses

### Plugin State Folder
- **Setting**: `historyFolder`
- **Type**: String
- **Default**: `gemini-scribe`
- **Description**: Folder where plugin stores history, prompts, and sessions
- **Structure**:
  ```
  gemini-scribe/
  ├── History/        # Legacy chat history files (v3.x)
  ├── Prompts/        # Custom prompt templates
  └── Agent-Sessions/ # Agent mode sessions with conversation history
  ```

### Enable Chat History
- **Setting**: `chatHistory`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Save chat conversations to markdown files
- **Note**: Chat history is stored in Agent Sessions folder in v4.0.0

### Summary Frontmatter Key
- **Setting**: `summaryFrontmatterKey`
- **Type**: String
- **Default**: `"summary"`
- **Description**: Frontmatter key used when storing document summaries

## Model Configuration

All models are selected from available Gemini models. The plugin supports dynamic model discovery to automatically fetch the latest models from Google's API.

### Chat Model
- **Setting**: `chatModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b` (or latest available)
- **Description**: Model used for agent chat conversations
- **Available Models**:
  - `gemini-2.0-flash-exp` - Latest experimental model
  - `gemini-1.5-flash` - Fast, efficient model
  - `gemini-1.5-flash-8b` - Smaller, faster variant
  - `gemini-1.5-pro` - Most capable model

### Summary Model
- **Setting**: `summaryModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Description**: Model used for document summarization and selection-based text rewriting
- **Used by**: Summarize Active File command, Rewrite text with AI command

### Completions Model
- **Setting**: `completionsModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Description**: Model used for IDE-style auto-completions
- **Note**: Completions must be enabled via command palette

## Custom Prompts

Custom prompts allow you to create reusable AI instruction templates that modify how the AI behaves for specific notes or sessions.

### Allow System Prompt Override
- **Setting**: `allowSystemPromptOverride`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Allow custom prompts to completely replace the default system prompt
- **Warning**: Enabling this may break expected functionality if custom prompts don't include essential instructions

### Creating Custom Prompts
1. Create a markdown file in `[Plugin State Folder]/Prompts/`
2. Write your custom instructions in the file
3. Reference it in note frontmatter: `gemini-scribe-prompt: "[[Prompt Name]]"`
4. Or select it in session settings modal

See the [Custom Prompts Guide](custom-prompts-guide.md) for detailed instructions.

## UI Settings

### Enable Streaming
- **Setting**: `streamingEnabled`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable streaming responses in the chat interface for a more interactive experience
- **Note**: When disabled, full responses are displayed at once

## Developer Settings

Advanced settings for developers and power users. Access by clicking "Show Advanced Settings" in the plugin settings.

### Debug Mode
- **Setting**: `debugMode`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable detailed console logging for troubleshooting
- **Use case**: Debugging API issues, tool execution problems, or unexpected behavior

### API Configuration

#### Maximum Retries
- **Setting**: `maxRetries`
- **Type**: Number
- **Default**: `3`
- **Description**: Maximum number of retry attempts when a model request fails
- **Note**: Uses exponential backoff between retries

#### Initial Backoff Delay
- **Setting**: `initialBackoffDelay`
- **Type**: Number (milliseconds)
- **Default**: `1000`
- **Description**: Initial delay before the first retry attempt
- **Note**: Subsequent retries use exponential backoff (2x, 4x, 8x, etc.)

### Model Parameters

#### Temperature
- **Setting**: `temperature`
- **Type**: Number (0.0-2.0)
- **Default**: `0.7`
- **Description**: Controls response creativity and randomness
  - **Lower (0.0-0.5)**: More focused, deterministic, consistent
  - **Medium (0.5-1.0)**: Balanced creativity and coherence
  - **Higher (1.0-2.0)**: More creative, varied, unpredictable
- **Note**: Ranges automatically adjusted based on selected model's capabilities

#### Top-P
- **Setting**: `topP`
- **Type**: Number (0.0-1.0)
- **Default**: `1.0`
- **Description**: Controls response diversity via nucleus sampling
  - **Lower values (0.1-0.5)**: More focused on likely tokens
  - **Higher values (0.5-1.0)**: More diverse vocabulary
- **Note**: Works in conjunction with temperature

### Model Discovery

Dynamic model discovery automatically fetches the latest available Gemini models and their capabilities from Google's API.

#### Enable Model Discovery
- **Setting**: `modelDiscovery.enabled`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Automatically discover and update available Gemini models

#### Auto-Update Interval
- **Setting**: `modelDiscovery.autoUpdateInterval`
- **Type**: Number (hours)
- **Default**: `24`
- **Description**: How often to check for new models (0 to disable)
- **Range**: 0-168 hours (0-7 days)

#### Fallback to Static Models
- **Setting**: `modelDiscovery.fallbackToStatic`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Use built-in model list when API discovery fails
- **Recommendation**: Keep enabled for reliability

#### Last Update
- **Setting**: `modelDiscovery.lastUpdate`
- **Type**: Number (timestamp)
- **Description**: Timestamp of last successful model discovery
- **Note**: Read-only, automatically updated

### Tool Execution

#### Stop on Tool Error
- **Setting**: `stopOnToolError`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Stop agent execution when a tool call fails
- **When enabled**: Agent stops immediately if any tool fails
- **When disabled**: Agent continues executing subsequent tools despite failures

### Tool Loop Detection

Prevents the AI agent from executing identical tools repeatedly, which can cause infinite loops.

#### Enable Loop Detection
- **Setting**: `loopDetectionEnabled`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Detect and prevent infinite tool execution loops

#### Loop Threshold
- **Setting**: `loopDetectionThreshold`
- **Type**: Number
- **Default**: `3`
- **Range**: 2-10
- **Description**: Number of identical tool calls before a loop is detected

#### Time Window
- **Setting**: `loopDetectionTimeWindowSeconds`
- **Type**: Number (seconds)
- **Default**: `30`
- **Range**: 10-120
- **Description**: Time window for detecting repeated calls
- **Example**: If threshold is 3 and window is 30s, calling the same tool 3+ times within 30 seconds triggers detection

## Session-Level Settings

Session settings override global defaults for specific agent sessions. Access via the settings icon in the session header.

### Model Configuration
- **Model**: Override the default chat model for this session
- **Temperature**: Session-specific temperature setting
- **Top-P**: Session-specific top-p setting
- **Custom Prompt**: Select a custom prompt template for this session

### Context Files
- Add specific notes as persistent context for the session
- Context files are automatically included with every message
- Use @ mentions in chat to add files
- Active note is automatically included by default

### Permissions
Session-level permissions allow bypassing confirmation dialogs for specific operations during the current session only.

Available permission bypasses:
- File creation
- File modification
- File deletion
- File moving/renaming

**Note**: Permissions reset when you create a new session or load a different session.

## Settings Migration

When upgrading from v3.x to v4.0.0:
1. History files are automatically migrated to Agent Sessions format
2. Backups are created in `History-Archive` folder
3. Obsolete settings (sendContext, maxContextDepth, searchGrounding) are removed
4. New settings get sensible defaults

## Performance Considerations

- **Model Selection**: Flash models (8B, standard) are faster but less capable than Pro models
- **Temperature**: Higher values may require more processing time
- **Model Discovery**: Minimal performance impact; runs in background
- **Loop Detection**: Negligible overhead; recommended to keep enabled

## Security Best Practices

1. **API Key**: Never share your API key or commit it to version control
2. **System Folders**: Plugin automatically protects `.obsidian` and plugin state folders from tool operations
3. **Tool Permissions**: Review tool operations before approving (when confirmations are enabled)
4. **System Prompt Override**: Use with caution; can break expected functionality

## Troubleshooting

### Models not appearing
1. Check API key is valid
2. Enable Model Discovery in Developer Settings
3. Click "Refresh models" button
4. Check console for errors (with Debug Mode enabled)

### Tool execution issues
1. Enable Debug Mode
2. Check Loop Detection settings
3. Review Stop on Tool Error setting
4. Examine console logs for specific errors

### Chat history not saving
1. Verify "Enable Chat History" is toggled on
2. Check Plugin State Folder path is valid
3. Ensure you have write permissions to vault

For more help, see [Documentation Hub](README.md) or [open an issue](https://github.com/allenhutchison/obsidian-gemini/issues).
