# Settings Reference

This document provides a comprehensive reference for all Obsidian Gemini Scribe settings.

The settings tab is organised into a permanently-open **General** section at the top — covering provider, API key, models, and the plugin state folder — followed by collapsible sections (▶ collapsed, ▼ expanded). Click any header to toggle it; expand/collapse state is remembered between sessions in the `expandedSettingsSections` setting. All collapsible sections start collapsed.

The order of sections is:

1. **General** (always open) — provider, API key, models, plugin state folder, Show Advanced Settings toggle.
2. **User Experience** — your name, frontmatter key, streaming, diff view, session history toggle, tool execution logging.
3. **Automation** — scheduled tasks, scheduler catch-up, and lifecycle hooks combined.
4. **Vault Search Index** — semantic search over your vault using Google File Search.

Advanced sections — Tool Permissions, MCP Servers, Agent Config, Debug — are tagged with an **ADVANCED** pill and only appear after toggling **Show Advanced Settings** at the bottom of General. **Agent Config** bundles four related sub-areas (Custom Prompts, API Configuration, Context Management, Tool Loop Detection) under one collapsible since they all tune how the agent talks to the model.

## Table of Contents

The reference below groups settings by topic for lookup, which doesn't always map 1:1 to the UI section names. The annotation in parentheses tells you which UI section a topic appears under.

- [Basic Settings](#basic-settings) (UI: _General_ — provider, API key, models, plugin state folder)
- [Model Configuration](#model-configuration) (UI: _General_ — chat/summary/completion/image model selection)
- [Custom Prompts](#custom-prompts) (UI: _Agent Config_ — advanced)
- [UI Settings](#ui-settings) (UI: _User Experience_ — streaming, diff view, identity, frontmatter key, session history)
- [Context Management](#context-management) (UI: _Agent Config_ — advanced)
- [Developer Settings](#developer-settings) (UI: split across _Agent Config_, _Tool Permissions_, _MCP Servers_, _Debug_)
- [Session-Level Settings](#session-level-settings)

UI sections without a dedicated topic in this reference: _Automation_ (covered in the [Scheduled Tasks](/guide/scheduled-tasks) and [Lifecycle Hooks](/guide/lifecycle-hooks) guides) and _Vault Search Index_ (covered in [Semantic Search](/guide/semantic-search)).

## Basic Settings

### Provider

- **Setting**: `provider`
- **Type**: `'gemini' | 'ollama'`
- **Default**: `'gemini'`
- **Description**: Selects the model backend. `gemini` calls the Google Cloud API; `ollama` calls a local Ollama daemon.
- **Notes**: Switching providers re-initialises the plugin and resets stale model selections to the new provider's defaults. Provider-coupled features (Google Search, URL Context, Deep Research, image generation, RAG indexing) are hidden when `ollama` is active. See the [Ollama Setup Guide](/guide/ollama-setup) for details.

### Ollama Base URL

- **Setting**: `ollamaBaseUrl`
- **Type**: String
- **Default**: `http://localhost:11434`
- **Required when provider is `ollama`**: Yes
- **Description**: HTTP endpoint of your Ollama daemon. Update if Ollama runs on a different host or port.

### API Key

- **Type**: String
- **Required**: Yes (when provider is `gemini`; ignored for `ollama`)
- **Storage**: Stored securely using Obsidian's SecretStorage API (not saved in `data.json`)
- **Description**: Your Google AI API key for accessing Gemini models
- **How to obtain**: Visit [Google AI Studio](https://aistudio.google.com/apikey)
- **Migration**: If upgrading from a previous version, your API key is automatically migrated from `data.json` to secure storage on first load

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
  ```text
  gemini-scribe/
  ├── History/          # Legacy chat history files (v3.x)
  ├── Prompts/          # Custom prompt templates
  ├── Skills/           # Custom agent skills (<skill-name>/SKILL.md)
  ├── Agent-Sessions/   # Agent mode sessions with conversation history
  ├── Scheduled-Tasks/  # Scheduled task definitions and run output
  ├── Background-Tasks/ # Output from background deep-research and image-gen tasks
  ├── Hooks/            # Lifecycle hook definitions and run output (created when hooksEnabled is true)
  ├── debug.log         # Current log file (when file logging is enabled)
  └── debug.log.old     # Previous rotated log file
  ```

### Enable Session History

- **Setting**: `chatHistory`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Store agent session history as markdown files in your vault
- **Note**: Sessions are saved in the Agent-Sessions subfolder with auto-generated titles

### Summary Frontmatter Key

- **Setting**: `summaryFrontmatterKey`
- **Type**: String
- **Default**: `"summary"`
- **Description**: Frontmatter key used when storing document summaries

## Model Configuration

The active model list depends on the [`provider`](#provider) setting:

- **Gemini (default)** — models are selected from the bundled Gemini list, refreshed from Google's API on startup so the latest models appear automatically. `imageModelName` is only available on this provider.
- **Ollama** — the chat / summary / completion dropdowns are populated from `GET <ollamaBaseUrl>/api/tags`, listing whatever you have pulled. Click "Refresh model list" in settings if a freshly pulled model doesn't appear. Image generation is unavailable in this mode.

### Chat Model

- **Setting**: `chatModelName`
- **Type**: String
- **Default**: `gemini-flash-latest`
- **Description**: Model used for agent chat conversations
- **Available Models**:
  - `gemini-flash-latest` - Gemini Flash Latest (fast and efficient, default for chat)
  - `gemini-2.5-pro` - Gemini 2.5 Pro (most capable, requires billing)
  - `gemini-flash-lite-latest` - Gemini Flash Lite Latest (lightweight)
  - `gemini-3.1-pro-preview` - Gemini 3.1 Pro Preview (experimental)
- **Note**: Model discovery automatically fetches the latest available models from Google's API

### Summary Model

- **Setting**: `summaryModelName`
- **Type**: String
- **Default**: `gemini-flash-latest`
- **Description**: Model used for document summarization and selection-based text rewriting
- **Used by**: Summarize Active File command, Rewrite text with AI command

### Completions Model

- **Setting**: `completionsModelName`
- **Type**: String
- **Default**: `gemini-flash-lite-latest`
- **Description**: Model used for IDE-style auto-completions
- **Note**: Completions must be enabled via command palette

### Image Model

- **Setting**: `imageModelName`
- **Type**: String
- **Default**: `gemini-2.5-flash-image`
- **Only available when**: Provider is `gemini`
- **Description**: Model used for image generation via the `generate_image` tool and the **Generate Image** command. Only models with image-generation capability appear in this dropdown.

## Custom Prompts

Custom prompts allow you to create reusable AI instruction templates that modify how the AI behaves for specific sessions.

### Allow System Prompt Override

- **Setting**: `allowSystemPromptOverride`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Allow custom prompts to completely replace the default system prompt
- **Warning**: Enabling this may break expected functionality if custom prompts don't include essential instructions

### Creating Custom Prompts

1. Create a markdown file in `[Plugin State Folder]/Prompts/`
2. Write your custom instructions in the file
3. Select it in the session settings modal (gear icon in the agent panel)

See the [Custom Prompts Guide](/guide/custom-prompts) for detailed instructions.

## UI Settings

### Enable Streaming

- **Setting**: `streamingEnabled`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable streaming responses in the chat interface for a more interactive experience
- **Note**: When disabled, full responses are displayed at once

### Auto-run missed scheduled tasks on startup

- **Setting**: `autoRunCatchUp`
- **Type**: Boolean
- **Default**: `false`
- **Description**: When enabled, tasks with `runIfMissed: true` that were missed while Obsidian was closed are submitted silently as background tasks on startup, without showing the approval modal.
- **When disabled**: The "Missed Scheduled Runs" modal appears on startup so you can choose Run or Skip per task. A red `!` badge on the status bar persists if the modal is dismissed without acting.
- **See also**: [Catch-up Runs](/guide/scheduled-tasks#catch-up-runs)

### Enable lifecycle hooks

- **Setting**: `hooksEnabled`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Subscribe to vault events (file created/modified/deleted/renamed) and dispatch them to hook definitions in `<history-folder>/Hooks/`. Each matching event fires a headless agent run with debounce, rate-limit, and loop-prevention guards.
- **Why opt-in**: Vault events fire continuously; an unintentionally-broad hook can drain API quota quickly. The default is off so users opt in deliberately.
- **See also**: [Lifecycle Hooks](/guide/lifecycle-hooks)

### Expanded Settings Sections

- **Setting**: `expandedSettingsSections`
- **Type**: `string[]`
- **Default**: `[]`
- **Description**: Internal list of section ids that are currently expanded in the settings tab. Updated automatically when you toggle a section. Known ids: `ui`, `automation`, `rag`, `tool-permissions`, `mcp-servers`, `agent-config`, `debug`. (General is always open; it has no id and ignores this setting.)
- **Note**: Edit `data.json` directly to pre-expand sections (for example, on a new install) or restore a custom layout after migrating vaults.

## Context Management

Context management automatically monitors and controls conversation size to prevent exceeding model token limits.

### Context Compaction Threshold

- **Setting**: `contextCompactionThreshold`
- **Type**: Number (percentage, 5-50)
- **Default**: `20`
- **Description**: Percentage of the model's input context window at which automatic compaction occurs
- **How it works**: When conversation tokens exceed this percentage, older turns are summarized and replaced with a compact summary while preserving recent messages
- **Hard ceiling**: Aggressive compaction triggers at 80% of the input limit to prevent API errors

### Two-phase compaction

When a session crosses the compaction threshold the plugin runs a cheaper pass before reaching for full summarization:

1. **Phase 1 — tool-result truncation.** Walks history and replaces oversized (>4 KB) `functionResponse` payloads in older turns with a small `{ truncated: true, truncatedFrom: N, note: "..." }` marker. The most recent two tool-result turns are kept intact so the agent reasoning across recent tool calls still has the full text. This is purely structural — no LLM call, no extra tokens spent.
2. **Re-evaluation.** If phase 1 freed enough room to put us back under the threshold (e.g., a single 600 KB `read_file` was responsible for most of the bloat), the request goes out with the truncated history and phase 2 is skipped entirely.
3. **Phase 2 — summarization.** Only fires when truncation alone wasn't enough. Older turns are summarized via an LLM call into a single context-summary entry preserving recent messages.

Below the threshold, neither phase fires — older history bytes are left untouched so Gemini's implicit prefix cache stays valid and subsequent turns keep their cached-token discount. Truncation breaks the cache from the modified point forward, so it's restricted to turns where we'd be paying that cost anyway (compaction would have run otherwise).

Re-issuing a tool call brings the full output back if the agent needs it. The behavior is always-on and not currently exposed as a setting.

### Show Token Usage

- **Setting**: `showTokenUsage`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Display estimated token count in the agent input area
- **Display format**: `Tokens: ~N (Y new) / M (X%)` showing total prompt tokens, uncached (new) tokens, model limit, and percentage used
- **How it works**: Token counts update live after each API response, including during tool call chains. Gemini's implicit caching means repeated content (system prompt, tool definitions) is served from cache — the "new" count shows tokens that aren't cached
- **Visual indicators**:
  - Normal (muted text) — well under threshold
  - Yellow — approaching compaction threshold (≥80% of threshold)
  - Orange/red — at or above compaction threshold

### Log Tool Execution to Session History

- **Setting**: `logToolExecution`
- **Type**: Boolean
- **Default**: `true`
- **Description**: Append a summary of each tool execution to the session history file for auditing
- **Format**: Collapsible callout blocks showing tool name, key parameters, status, and duration
- **Note**: Requires plugin reload to take effect when toggled

### Always Show Diff View for File Writes

- **Setting**: `alwaysShowDiffView`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Automatically open a diff view when the agent proposes file changes, instead of requiring a button click
- **When off**: The confirmation card shows a summary and a "View Changes" button. Click it to open the diff view
- **When on**: The diff view opens automatically alongside the confirmation card
- **Note**: The diff view lets you edit the proposed content before approving. If you modify content, the tool result reports `userEdited: true` so the agent knows

## Developer Settings

Advanced settings for developers and power users. Access by clicking "Show Advanced Settings" in the plugin settings.

### Debug Mode

- **Setting**: `debugMode`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable detailed console logging for troubleshooting
- **Use case**: Debugging API issues, tool execution problems, or unexpected behavior

### Log to File

- **Setting**: `fileLogging`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Write log entries to a file (`debug.log`) in the plugin state folder
- **Behavior**:
  - Errors and warnings are always written to the log file when enabled
  - Debug-level entries (`log()`, `debug()`) are only written when Debug Mode is also enabled
  - Log files are automatically rotated at 1 MB (previous log kept as `debug.log.old`)
  - Writes are batched and debounced to minimize I/O impact
- **Use case**: Sharing diagnostic information in bug reports, or letting the agent self-diagnose issues via the bundled `gemini-scribe-help` skill (which exposes `debug.log` and `debug.log.old` as activatable resources only when this setting is on)
- **Note**: Log files are stored in the plugin state folder and are automatically excluded from RAG indexing. The standard `read_file` tool blocks the state folder; the help skill is the supported path for the agent to read these logs.

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

Model discovery is automatic — no user-configurable settings are required. On startup, the plugin fetches the latest available Gemini models from Google's API and falls back to the bundled list if the fetch fails. When using the Ollama provider, a **Refresh model list** button appears in Settings → General to re-query the Ollama daemon for newly pulled models. The remote model list is cached in `data.json` under `remoteModelCache` (managed internally; do not edit by hand).

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

### MCP Servers

MCP (Model Context Protocol) server support allows the agent to use tools from external MCP servers. Supports both local (stdio) and remote (HTTP) servers.

#### Enable MCP Servers

- **Setting**: `mcpEnabled`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable connections to MCP servers for external tool integration

#### Server List

- **Setting**: `mcpServers`
- **Type**: Array of server configurations
- **Default**: `[]`
- **Description**: List of MCP server configurations

Each server configuration includes:

| Field          | Type     | Description                                                                |
| -------------- | -------- | -------------------------------------------------------------------------- |
| `name`         | String   | Unique server name                                                         |
| `transport`    | String   | Transport type: `"stdio"` (local) or `"http"` (remote). Default: `"stdio"` |
| `command`      | String   | Command to spawn the server (stdio only)                                   |
| `args`         | String[] | Command arguments (stdio only)                                             |
| `url`          | String   | Server URL (http only, e.g., `http://localhost:3000/mcp`)                  |
| `env`          | Object   | Optional environment variables                                             |
| `enabled`      | Boolean  | Connect on plugin load                                                     |
| `trustedTools` | String[] | Tools that skip confirmation                                               |

See the [MCP Servers Guide](/guide/mcp-servers) for setup instructions.

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

## Performance Considerations

- **Model Selection**: Flash models (8B, standard) are faster but less capable than Pro models
- **Temperature**: Higher values may require more processing time
- **Model Discovery**: Minimal performance impact; runs in background
- **Loop Detection**: Negligible overhead; recommended to keep enabled

## Security Best Practices

1. **API Key**: Your API key is stored securely via Obsidian's SecretStorage and is not written to `data.json`. Never share your API key or commit it to version control
2. **System Folders**: Plugin automatically protects `.obsidian` and plugin state folders from tool operations
3. **Tool Permissions**: Review tool operations before approving (when confirmations are enabled)
4. **System Prompt Override**: Use with caution; can break expected functionality

## Troubleshooting

### Models not appearing

1. Check API key is valid
2. For Gemini: restart Obsidian — model discovery runs automatically on startup
3. For Ollama: go to Settings → General and click **Refresh** in the **Refresh model list** row after pulling new models
4. Check console for errors (with Debug Mode enabled)

### Tool execution issues

1. Enable Debug Mode and Log to File
2. Check Loop Detection settings
3. Review Stop on Tool Error setting
4. Examine console logs or `debug.log` in the plugin state folder for specific errors

### Chat history not saving

1. Verify "Enable Session History" is toggled on
2. Check Plugin State Folder path is valid
3. Ensure you have write permissions to vault

For more help, see the [Getting Started Guide](/guide/getting-started) or [open an issue](https://github.com/allenhutchison/obsidian-gemini/issues).
