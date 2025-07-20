# Settings Reference

This document provides a comprehensive reference for all Obsidian Gemini Scribe settings.

## Table of Contents
- [Basic Settings](#basic-settings)
- [Model Configuration](#model-configuration)
- [Agent Mode Settings](#agent-mode-settings)
- [Custom Prompts](#custom-prompts)
- [Advanced Settings](#advanced-settings)
- [Session-Level Settings](#session-level-settings)

## Basic Settings

### API Key
- **Setting**: `apiKey`
- **Type**: String
- **Required**: Yes
- **Description**: Your Google AI API key for accessing Gemini models
- **How to obtain**: Visit [Google AI Studio](https://makersuite.google.com/app/apikey)

### State Folder
- **Setting**: `historyFolder`
- **Type**: String
- **Default**: `gemini-scribe`
- **Description**: Folder where plugin stores history, prompts, and sessions
- **Structure**:
  ```
  gemini-scribe/
  ├── History/        # Chat history files
  ├── Prompts/        # Custom prompt templates
  └── Agent-Sessions/ # Agent mode sessions
  ```

### Enable Chat History
- **Setting**: `chatHistory`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Save chat conversations to markdown files

### Enable Periodic Notes Context
- **Setting**: `enablePeriodicNotesContext`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Include content from current periodic (daily/weekly) notes

### Context Linking Depth
- **Setting**: `contextLinkingDepth`
- **Type**: Number (0-5)
- **Default**: `1`
- **Description**: How many levels of linked notes to include as context
- **Impact**: Higher values provide more context but use more tokens

## Model Configuration

### Chat Model
- **Setting**: `chatModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Options**: 
  - `gemini-2.0-flash-exp` - Latest experimental model
  - `gemini-1.5-flash` - Fast, efficient model
  - `gemini-1.5-flash-8b` - Smaller, faster variant
  - `gemini-1.5-pro` - Most capable model
- **Used for**: Note-centric chat, general conversations

### Summary Model
- **Setting**: `summaryModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Used for**: Document summarization

### Rewrite Model
- **Setting**: `rewriteModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Used for**: Selection-based text rewriting

### Completions Model
- **Setting**: `completionsModelName`
- **Type**: String
- **Default**: `gemini-1.5-flash-8b`
- **Used for**: Auto-completions while typing

### Agent Model
- **Setting**: `agentModelName`
- **Type**: String
- **Default**: `gemini-1.5-pro`
- **Used for**: Agent mode with tool calling
- **Note**: Should use a capable model that supports function calling

### Model Parameters

#### Temperature
- **Setting**: `temperature`
- **Type**: Number (0.0-2.0)
- **Default**: `0.7`
- **Description**: Controls response creativity
  - Lower (0.0-0.5): More focused, deterministic
  - Medium (0.5-1.0): Balanced
  - Higher (1.0-2.0): More creative, varied

#### Top-P
- **Setting**: `topP`
- **Type**: Number (0.0-1.0)
- **Default**: `1.0`
- **Description**: Controls response diversity via nucleus sampling
  - Lower values: More focused on likely tokens
  - Higher values: More diverse vocabulary

## Agent Mode Settings

### Enable Agent Mode
- **Setting**: `enableAgentMode`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable AI agent with tool-calling capabilities

### Enabled Tool Categories
- **Setting**: `enabledTools`
- **Type**: Array of strings
- **Default**: `[]`
- **Options**:
  - `read_only` - File reading and searching
  - `vault_operations` - File creation, modification, deletion
  - `web_operations` - Web search and URL fetching
- **Example**: `["read_only", "web_operations"]`

### Require Confirmation
- **Setting**: `requireConfirmation`
- **Type**: Object
- **Default**: 
  ```json
  {
    "create_files": true,
    "modify_files": true,
    "delete_files": true,
    "move_files": true
  }
  ```
- **Description**: Which operations require user confirmation

### Stop on Tool Error
- **Setting**: `stopOnToolError`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Stop agent execution when a tool fails

### Loop Detection

#### Enable Loop Detection
- **Setting**: `loopDetectionEnabled`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Prevent agent from executing identical tools repeatedly

#### Loop Detection Threshold
- **Setting**: `loopDetectionThreshold`
- **Type**: Number
- **Default**: `3`
- **Description**: Number of identical calls before loop is detected

#### Loop Detection Time Window
- **Setting**: `loopDetectionTimeWindowSeconds`
- **Type**: Number
- **Default**: `30`
- **Description**: Time window for detecting repeated calls

## Custom Prompts

### Enable Custom Prompts
- **Setting**: `enableCustomPrompts`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Allow using custom prompt templates

### Custom Prompt Folder
- **Setting**: `customPromptsFolder`
- **Type**: String
- **Default**: `Prompts` (relative to state folder)
- **Description**: Where custom prompt templates are stored

## Advanced Settings

### Enable Completions
- **Setting**: `enableCompletions`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable AI-powered auto-completions

### Enable Search Grounding
- **Setting**: `searchGrounding`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Include web search results in responses
- **Note**: Incompatible with function calling

### Search Grounding Threshold
- **Setting**: `searchGroundingThreshold`
- **Type**: Number (0.0-1.0)
- **Default**: `0.3`
- **Description**: Confidence threshold for including search results

### Debug Mode
- **Setting**: `debugMode`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable detailed logging for troubleshooting

## Session-Level Settings

These settings can be configured per session and override global defaults:

### Model Configuration
- **Model**: Override the default model for this session
- **Temperature**: Session-specific temperature setting
- **Top-P**: Session-specific top-p setting
- **Prompt Template**: Custom prompt template for this session

### Permissions (Agent Mode)
- **Bypass Confirmations**: List of operations that don't require confirmation
- **Enabled Tools**: Override which tools are available in this session

### Access Session Settings
1. In Agent Chat, click the settings icon next to the session name
2. Or use the command: "Gemini Scribe: Configure Current Session"
3. Settings are saved with the session and persist across reloads

## Settings Migration

When upgrading, the plugin automatically:
1. Migrates folder structure to new organization
2. Preserves existing settings
3. Applies sensible defaults to new settings

## Performance Considerations

- **Context Depth**: Higher values increase API costs and latency
- **Model Selection**: Flash models are faster but less capable
- **Search Grounding**: Adds latency but provides current information
- **Temperature**: Higher values may require more processing time

## Security Best Practices

1. **API Key**: Never share your API key or commit it to version control
2. **Agent Permissions**: Start with read-only access and gradually enable more
3. **Confirmations**: Keep confirmations enabled for destructive operations
4. **System Folders**: Plugin automatically protects .obsidian and plugin folders