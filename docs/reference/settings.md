# Settings Reference

This document provides a comprehensive reference for all Obsidian Gemini Scribe settings.

The settings tab is built on Obsidian's declarative settings API (requires **Obsidian 1.13.1 or
later**). It is a flat list of **13 top-level rows in 5 groups**; most rows open a sub-page with
a back button rather than expanding in place — there are no collapsible `<details>` sections and
nothing is hidden behind a "Show advanced settings" toggle. Every page (including sub-pages) is
covered by Obsidian's native settings search.

Top-level rows, in order:

| Row                                    | Type   | Group         |
| -------------------------------------- | ------ | ------------- |
| **Providers**                          | page   | _(ungrouped)_ |
| **Features**                           | page   | _(ungrouped)_ |
| Your name                              | text   | Chat          |
| Keep session history                   | toggle | Chat          |
| Review a diff before files are written | toggle | Chat          |
| **Vault search index**                 | page   | Vault         |
| Plugin folder                          | folder | Vault         |
| **Scheduled tasks**                    | page   | Automation    |
| **Lifecycle hooks**                    | page   | Automation    |
| **MCP servers**                        | page   | Automation    |
| **Tool permissions**                   | page   | _(ungrouped)_ |
| **Advanced**                           | page   | _(ungrouped)_ |
| Documentation                          | action | _(ungrouped)_ |

## Table of Contents

- [Providers](#providers)
- [Features](#features)
- [Chat group](#chat-group)
- [Vault search index](#vault-search-index)
- [Plugin folder](#plugin-folder)
- [Automation](#automation)
- [Tool permissions](#tool-permissions)
- [Advanced](#advanced)
- [Data model](#data-model)
- [Session-Level Settings](#session-level-settings)
- [Troubleshooting](#troubleshooting)

## Providers

The Providers page holds one **connection card** per account/endpoint: Gemini, Ollama, OpenAI,
and Anthropic. **A card never assigns a provider to a feature** — that only
happens on the [Features](#features) page. Each card's `displayValue` on the Providers list
summarizes its connection state (Connected / Not set up / Unreachable).

### Gemini card

- **API key** (`apiKeySecretName`) — String, SecretStorage key name (the key value itself is
  never written to `data.json`). Get one at [Google AI Studio](https://aistudio.google.com/apikey).
- **Custom endpoint** (`customBaseUrl`) — String, default `""` (empty, uses the official Google
  endpoint). Overrides the Google API base URL for every Google GenAI SDK call site (chat,
  streaming, image generation, web fetch, Google Search/Maps grounding, RAG indexing, deep
  research, context management). Validated as a URL inline; an invalid value shows an error and
  is not saved. Use this to route requests through a corporate proxy, local gateway, or regional
  mirror. **Security note**: requests routed through a custom endpoint still include your Google
  API key in the `x-goog-api-key` header.
- **Available models** — read-only count + last-refresh time, with a **Refresh** button.
  Gemini's model list is loaded from the bundled catalog and auto-refreshed from GitHub on
  startup (cached 24h); click Refresh (or run **Gemini Scribe: Refresh model list**) to bypass
  the cache immediately. See [Model Discovery](#model-discovery) below.
- **Includes** — capability-driven, read-only: Google Maps grounding, Page fetch by URL. These
  are provider-bound extras that ride on the Gemini connection rather than being routed features
  in their own right — see [Provider-bound grounding](#provider-bound-grounding).
- **Used by** — read-only list of the features currently routed to Gemini.

### Ollama card

- **Endpoint** (`ollamaBaseUrl`) — String, default `http://localhost:11434`. HTTP address of
  your Ollama daemon. Validated as a URL.
- **Available models** — count + **Refresh** button, re-querying `GET <ollamaBaseUrl>/api/tags`
  for models pulled since the plugin loaded.
- **Used by** — read-only list of the features currently routed to Ollama.

### OpenAI card

- **API key** (`openaiApiKeySecretName`) — String, SecretStorage key name, default
  `""`. Any placeholder value satisfies a compatible server that doesn't check one.
- **Base URL** (`openaiBaseUrl`) — String, default `https://api.openai.com/v1`. Point this at an
  OpenAI-compatible local server instead — LM Studio, MLX, Ollama's own OpenAI-compatible
  endpoint, etc. — to keep requests on your machine.
- **Available models** — count + **Refresh** button, re-querying `GET <openaiBaseUrl>/models`.
- **Used by** — read-only list of the features currently routed to OpenAI.

### Anthropic card

- **API key** (`anthropicApiKeySecretName`) — String, SecretStorage key name, default `""`. Get
  one at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). There is
  no base URL setting — requests always go to `api.anthropic.com`.
- **Available models** — count + **Refresh** button. The curated Claude models, narrowed by
  `GET https://api.anthropic.com/v1/models` to those the key can use (the full curated list is
  shown without a key or when the endpoint is unreachable).
- **Used by** — read-only list of the features currently routed to Anthropic.

See the [Anthropic Setup Guide](/guide/anthropic-setup) for the model list and request behavior.

### Default provider

- **Setting**: `defaultProvider`
- **Type**: `'gemini' | 'ollama' | 'openai' | 'anthropic'`
- **Default**: `'gemini'`
- **Description**: The provider used by any feature you have not routed elsewhere. Changing it
  re-points every feature that was on the _previous_ default and that the new default can serve;
  features you explicitly set to Off, or that the new default cannot serve, are left alone —
  never moved to a third provider.

### Privacy note

One note (replacing the four notice variants of earlier versions), composed from which features
are actually routed to a non-local provider. See [Privacy semantics](/reference/provider-capabilities#privacy-semantics)
for the full policy: **a feature is never routed to the cloud on your behalf** — if the provider
serving a feature can't serve it, or isn't connected, that feature is off, never silently
substituted.

## Features

One row per feature, each showing `<provider> · <model>` (or **Off**). Opening a row gives
**exactly two controls**: a provider dropdown (listing only providers that support the feature,
plus Off) and, for features with a model, a model dropdown filtered to that provider.

Rows, grouped:

| Group            | Features                                           |
| ---------------- | -------------------------------------------------- |
| Text             | Chat and agent · Summaries · Completions · Rewrite |
| Web and research | Web search · Deep research · Vault search index    |
| Media            | Image generation                                   |

- **Chat and agent** (`features.chat`) — interactive chat, agent sessions, scheduled tasks,
  hooks. All four providers support it.
- **Summaries** (`features.summary`) — the "Summarize active file" command and conversation
  compaction. All four providers support it.
- **Completions** (`features.completions`) — IDE-style inline suggestions. All four providers
  support it.
- **Rewrite** (`features.rewrite`) — rewriting selected text. Has its own model field (it no
  longer silently borrows the chat model). All four providers support it.
- **Web search** (`features.webSearch`) — Google Search grounding and the web-fetch (URL
  context) tool ride together on this row. Gemini only today.
- **Deep research** (`features.deepResearch`) — the Deep Research managed agent. Gemini only;
  has no model field (the agent has no model parameter of its own) — the row shows a provider
  dropdown and a note instead.
- **Vault search index** (`features.rag`) — routes which provider's embeddings serve semantic
  search. Gemini only (Google File Search); has no model field. The row also reads **Off** when
  the [Vault search index](#vault-search-index) page's own "Index this vault" toggle is off,
  even if a provider is routed.
- **Image generation** (`features.imageGen`) — the `generate_image` tool and **Generate image**
  command. Supported by Gemini and OpenAI; OpenAI uses its dedicated Images API.

**Google Maps grounding is not a routed feature.** It is provider-bound to Gemini and listed
under the Gemini card's "Includes" line — see [Provider-bound grounding](#provider-bound-grounding).

### Off, unsupported, and unconfigured

Every feature's provider dropdown offers **Off** (`'none'`) as an explicit option, including
Chat. Three distinct non-serving states are surfaced differently on a row:

| State        | Cause                                                                              | Row shows                                                  |
| ------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Off          | You chose Off                                                                      | displayValue "Off" — **no** warning; being off is a choice |
| Unsupported  | Provider doesn't support this feature (stale data, or a future version dropped it) | `status: warning`, "Choose a provider"                     |
| Unconfigured | Provider supports it but isn't connected (no key, or an unreachable Ollama daemon) | `status: warning`, "`<provider>` · not connected"          |
| OK           | Otherwise                                                                          | "`<provider>` · `<model>`"                                 |

**No silent fallback**: a feature whose provider can't serve it, or isn't connected, is off — it
is never re-routed to a different provider behind your back. This applies even to Chat: choosing
Off for Chat means the agent view reports that no provider is configured, rather than the plugin
quietly talking to Gemini.

### Model options

A feature's model dropdown always includes a leading **Default** option, labelled with the model
it currently resolves to — e.g. **"Default (Claude Opus 5)"** for Chat on Anthropic, or
**"Default (Claude Haiku 4.5)"** for Completions. It is stored as `''` and resolved at request
time against the live model list, so it follows the provider's role default if that changes.
The Features row shows the same label. Until a provider's model list has loaded there is no
model to name, and the option reads **"Default for this provider"**. When the provider is
Ollama and the feature isn't Chat, the leading option instead reads **"Same as chat"** —
Ollama keeps one model resident at a time, so non-chat features default to reusing whichever
model chat already has loaded. If a stored model is no longer in the provider's live list (a
retired or un-pulled model), it still appears as an option labelled "No longer available" with an
inline error, so you can pick a replacement without losing sight of what was configured.

### Model Discovery

Model discovery is automatic — no user-configurable settings are required.

- **Gemini** — models are loaded from the bundled list and auto-refreshed from GitHub on startup
  (cached for 24h). Click **Refresh** on the Gemini provider card, or run the **Gemini Scribe:
  Refresh model list** command, to fetch the latest list immediately.
- **Ollama** — the model list is populated from `GET <ollamaBaseUrl>/api/tags`, listing whatever
  you have pulled. Click **Refresh** on the Ollama card if a freshly pulled model doesn't appear.
- **OpenAI** — the model list is populated from `GET <openaiBaseUrl>/models`, enriched with
  curated metadata (context window, vision support) for current `api.openai.com` models;
  unrecognized ids (typically from a compatible server) get conservative defaults. Click
  **Refresh** on the OpenAI card if a model doesn't appear.
- **Anthropic** — a curated list of Claude models, narrowed by `GET https://api.anthropic.com/v1/models`
  to what your key can use, with display names and context windows from that response. Click
  **Refresh** on the Anthropic card after your organization's model access changes.

When Google retires a model (the API starts returning 404 "no longer available"), it is removed
from the catalog and any route or remembered model still pointing at it is migrated
automatically on the next reload: to the retired model's designated successor when one exists,
otherwise reset to the provider's default.

### Provider-bound grounding

Google Maps grounding and Gemini's URL-context surface are **provider-bound**, not routed
features: the `google_maps` tool is registered whenever the Gemini provider is configured,
regardless of which provider is currently serving any Features row. Its model follows the
Web search row's model when Web search is on Gemini, otherwise it uses the bundled Gemini chat
default.

## Chat group

### Your name

- **Setting**: `userName`
- **Type**: String
- **Default**: `"User"`
- **Description**: Name used by the AI when addressing you in responses.

### Keep session history

- **Setting**: `chatHistory`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Store agent session history as markdown files in your vault, under
  `[Plugin folder]/Agent-Sessions/`, with auto-generated titles.

### Review a diff before files are written

- **Setting**: `alwaysShowDiffView`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Automatically open a diff view when the agent proposes file changes, instead
  of requiring a button click.
- **When off**: The confirmation card shows a summary and a "View changes" button. Click it to
  open the diff view.
- **When on**: The diff view opens automatically alongside the confirmation card.
- **Note**: The diff view lets you edit the proposed content before approving. If you modify
  content, the tool result reports `userEdited: true` so the agent knows.

## Vault search index

Semantic search over your vault using Google File Search (Gemini-only managed embeddings).
Everything below the first row is hidden until indexing is turned on.

- **Index this vault** (`ragIndexing.enabled`) — Boolean, default `false`. Turning this off with
  an existing index prompts for confirmation before deleting the store.
- **Status** — read-only file count, plus **Rescan** and **Delete index** buttons.
- **Index name** (`ragIndexing.fileSearchStoreName`) — read-only text + copy button.
- **Sync changes automatically** (`ragIndexing.autoSync`) — Boolean. Keep the index current as
  you edit the vault.
- **Include attachments** (`ragIndexing.includeAttachments`) — Boolean. Index non-markdown
  attachments alongside notes.
- **Exclude folders** (`ragIndexing.excludeFolders`) — `string[]`, entered one per line. The
  plugin state folder and `.obsidian` are always excluded regardless of this list.

See the [Semantic Search Guide](/guide/semantic-search) for a full walkthrough, and route the
provider for this feature on the [Features](#features) page — Gemini only today.

## Plugin folder

- **Setting**: `historyFolder`
- **Type**: String
- **Default**: `gemini-scribe`
- **Description**: Folder where the plugin stores history, prompts, and sessions.
- **Notes**: The value is normalized on load and when saved (via `normalizePath` semantics) — a
  hand-typed trailing, leading, or duplicate slash is corrected automatically, so folder exclusion
  and subfolder paths never break on a malformed path. Uses Obsidian's native folder suggester.
- **Structure**:
  ```text
  gemini-scribe/
  ├── History/          # Legacy note-centric chat history files (v3.x and earlier)
  ├── Prompts/          # Custom prompt templates
  ├── Skills/           # Custom agent skills (<skill-name>/SKILL.md)
  ├── Agent-Sessions/   # Agent mode sessions with conversation history
  ├── Scheduled-Tasks/  # Scheduled task definitions and run output
  ├── Background-Tasks/ # Output from background deep-research and image-gen tasks
  ├── Hooks/            # Lifecycle hook definitions and run output (created when hooksEnabled is true)
  ├── debug.log         # Current log file (when file logging is enabled)
  └── debug.log.old     # Previous rotated log file
  ```

## Automation

Each row below opens its own sub-page. Task/hook/server _management_ (creating, editing, running)
is covered in the [Scheduled tasks](/guide/scheduled-tasks), [Lifecycle Hooks](/guide/lifecycle-hooks),
and [MCP servers](/guide/mcp-servers) guides; this section covers the persistent settings each
page carries alongside its entry points.

### Scheduled tasks

- **Open scheduler / New task** — action rows opening the scheduler management modal.
- **Auto-run missed tasks on startup** (`autoRunCatchUp`) — Boolean, default `false`. When
  enabled, tasks with `runIfMissed: true` that were missed while Obsidian was closed run silently
  as background tasks on startup. When disabled, a "Missed scheduled runs" modal appears so you
  can choose Run or Skip per task.

### Lifecycle hooks

- **Enable lifecycle hooks** (`hooksEnabled`) — Boolean, default `false`, and the page's first
  row. Subscribes to vault events (file created/modified/deleted/renamed) and dispatches them to
  hook definitions in `[Plugin folder]/Hooks/`. Off by default because vault events fire
  continuously and an unintentionally-broad hook can drain API quota quickly.
- **Open hook manager / New hook** — action rows, visible once hooks are enabled.

### MCP servers

A native list — one row per configured server (name, transport summary, live connection status),
with an edit button per row and an **Add server** action opening the server modal. **There is no
enable toggle**: an empty list means MCP is off; deleting the last server turns it off
automatically.

- **Setting**: `mcpServers`
- **Type**: Array of server configurations
- **Default**: `[]`

Each server configuration includes:

| Field           | Type     | Description                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`          | String   | Unique server name                                                                             |
| `transport`     | String   | `"stdio"` (local) or `"http"` (remote). Default: `"stdio"`                                     |
| `command`       | String   | Command to spawn the server (stdio only)                                                       |
| `args`          | String[] | Command arguments (stdio only)                                                                 |
| `url`           | String   | Server URL (http only, e.g. `http://localhost:3000/mcp`)                                       |
| `envSecretName` | String   | SecretStorage key for the server's env vars (stdio only; values are not stored in `data.json`) |
| `enabled`       | Boolean  | Connect on plugin load                                                                         |
| `trustedTools`  | String[] | Tools that skip confirmation                                                                   |

Environment variable **values** are kept in Obsidian's SecretStorage (the OS keychain), not in
`data.json`. The config only stores `envSecretName`, a pointer to the keychain entry.

See the [MCP servers Guide](/guide/mcp-servers) for setup instructions.

## Tool permissions

Controls which agent tools execute automatically, which require user confirmation before each
run, and which are blocked entirely. One searchable group with filter pills — All / Read / Write
/ Destructive / External / MCP — over per-tool dropdown rows, fronted by a preset dropdown.

### Permission Preset

- **Setting**: `toolPolicy.activePreset`
- **Type**: String
- **Default**: `cautious`
- **Options**:

| Preset      | Label              | Read tools         | Write tools        | Destructive tools  | External tools     |
| ----------- | ------------------ | ------------------ | ------------------ | ------------------ | ------------------ |
| `read_only` | Read only          | Auto               | Blocked            | Blocked            | Blocked            |
| `cautious`  | Cautious (default) | Auto               | Ask                | Ask                | Ask                |
| `edit_mode` | Edit mode          | Auto               | Auto               | Ask                | Ask                |
| `yolo`      | YOLO mode          | Auto               | Auto               | Auto               | Auto               |
| `custom`    | Custom             | Per-tool overrides | Per-tool overrides | Per-tool overrides | Per-tool overrides |

- **YOLO mode warning**: Selecting YOLO mode requires explicit confirmation in a modal. All
  operations execute without prompts — use only in trusted, well-understood workflows.
- **Custom preset**: Automatically activated when you override any individual tool's permission.
  Selecting a named preset clears all per-tool overrides.

### Search and filter

- **Search box**: matches a tool's display name, its raw tool id, and its classification label
  (Read/Write/Destructive/External).
- **Filter pills**: All / Read / Write / Destructive / External / MCP. MCP matches tools named
  `mcp__<server>__<tool>`. Pills are a transient view state — they are not persisted.

### Per-Tool Overrides

- **Setting**: `toolPolicy.toolPermissions`
- **Type**: Object (tool name → permission)
- **Default**: `{}` (empty — preset governs all tools)
- **Description**: Each registered tool can be individually set to `deny` (blocked), `ask_user`
  (confirmation required), or `approve` (runs automatically) — these are the values persisted in
  `data.json` for this setting. A row shows the tool's _effective_ permission (preset or
  override). Overrides take precedence over the active preset; setting one switches the preset to
  `custom`. (This is distinct from the `toolPolicy` YAML block used by Projects, Scheduled Tasks,
  and Hooks, which uses the shorter `deny`/`ask`/`allow` aliases in frontmatter — see those
  guides.)

## Advanced

_(unnamed group)_

- **Context compaction threshold** (`contextCompactionThreshold`) — Number (percentage, 5-50),
  default `20`. Percentage of the model's input context window at which automatic compaction
  occurs. See [Context management](#context-management) below.
- **Stop the agent when a tool fails** (`stopOnToolError`) — Boolean, default `true`. When
  enabled, the agent stops immediately if any tool fails; when disabled, it continues executing
  subsequent tools despite failures.
- **Summary frontmatter key** (`summaryFrontmatterKey`) — String, default `"summary"`.
  Frontmatter key used when storing document summaries.
- **Record tool calls in session history** (`logToolExecution`) — Boolean, default `true`.
  Appends a collapsible callout (tool name, key parameters, status, duration) to the session
  history file for each tool execution, for auditing. Disabled (greyed out) when session history
  itself is off.

### Diagnostics

- **Debug mode** (`debugMode`) — Boolean, default `false`. Enables detailed console logging for
  troubleshooting.
- **Show token usage** (`showTokenUsage`) — Boolean, default `false`. Displays estimated token
  count in the agent input area as `Tokens: ~N / M (X%)`, with `· Y% cached` and `· Z reasoning`
  suffixes when applicable. Visual indicators: normal (well under threshold), yellow (≥80% of the
  compaction threshold), orange/red (at or above it).
- **Log API calls to a file** (`fileLogging`) — Boolean, default `false`. Writes log entries to
  `debug.log` in the plugin folder. Errors and warnings are always written when enabled;
  debug-level entries only when Debug mode is also on. Rotated at 1 MB (`debug.log.old` keeps the
  previous file). Useful for bug reports, or for the agent to self-diagnose via the bundled
  `gemini-scribe-help` skill, which exposes `debug.log`/`debug.log.old` as activatable resources
  only when this setting is on.

### Context management

Context management automatically monitors and controls conversation size to prevent exceeding
model token limits.

**How it works**: When conversation tokens exceed the [context compaction threshold](#advanced),
older turns are summarized and replaced with a compact summary while preserving recent messages.
A hard ceiling triggers aggressive compaction at 80% of the input limit to prevent API errors.

**Two-phase compaction**: a cheaper pass runs first —

1. **Phase 1 — tool-result truncation.** Walks history and replaces oversized (>4 KB)
   `functionResponse` payloads in older turns with a small
   `{ truncated: true, truncatedFrom: N, note: "..." }` marker. The most recent two tool-result
   turns are kept intact. Purely structural — no LLM call, no extra tokens spent.
2. **Re-evaluation.** If phase 1 freed enough room, the request goes out with the truncated
   history and phase 2 is skipped entirely.
3. **Phase 2 — summarization.** Only fires when truncation alone wasn't enough. Older turns are
   summarized via an LLM call into a single context-summary entry, preserving recent messages.

Below the threshold, neither phase fires, so Gemini's implicit prefix cache stays valid.
Re-issuing a tool call brings the full output back if the agent needs it. This behaviour is
always-on and not exposed as a setting beyond the threshold percentage.

`AgentLoop` re-checks after every tool batch (not just before the initial request), so a long
tool chain can be compacted mid-flight. Mid-loop compaction never touches the current tool
chain's own turns — only turns from before the chain started are eligible, so an in-progress
multi-step tool sequence is never summarized out from under itself.

## Data model

The settings redesign replaced the flat `provider` + `providerOverrides` + ten per-provider model
fields with a single dense routing table.

- **`features`** — `Record<FeatureId, { provider, model }>`, one entry per feature id (`chat`,
  `summary`, `completions`, `rewrite`, `webSearch`, `deepResearch`, `rag`, `imageGen`). `provider`
  is a real provider id or `'none'` ("off"); `model` is the stored model string, where `''` means
  "use the provider's default for this feature." This is what the [Features](#features) page
  reads and writes — see that section for the UI-facing view of the same data.
- **`providerModelMemory`** — `Partial<Record<ModelProvider, Partial<Record<FeatureId, string>>>>`.
  Remembers the last model you picked for each (provider, feature) pair, so re-routing a feature
  away from a provider and back restores the model you had there. Never read when resolving a
  request — only when a feature is re-pointed to a provider it was previously on.
  `providerModelMemory` was called "per-provider model fields" pre-redesign.
- **`settingsSchemaVersion`** — internal migration marker. `2` is current; `data.json` predating
  this key is treated as version `1`.

### Migration

Upgrading from a pre-redesign `data.json` runs a one-time, one-way migration on load:

- `provider` → `defaultProvider`; `providerOverrides.<useCase>` → the matching
  `features.<feature>.provider` (the old `webSearch` use case covered search, maps, URL context,
  _and_ deep research, so it seeds both `features.webSearch.provider` and
  `features.deepResearch.provider`).
- Any feature that had no explicit override and that the old primary provider **couldn't** serve
  becomes `'none'` — never silently assigned to the new default. This reproduces exactly what the
  pre-redesign settings resolved to; it does not turn on a feature that was off.
- The ten per-provider model fields (`chatModelName`, `ollamaModelName`, `openaiModelName`, …)
  are folded losslessly into `providerModelMemory`, then used to seed each feature's active
  `model`.
- MCP: if the old `mcpEnabled` toggle was not explicitly `true`, every server in `mcpServers` gets
  `enabled: false` (an absent server config predating that toggle is treated as "was off," not
  "was on").
- All removed keys (see below) are deleted from `data.json` once the migration completes.

The migration is one-way and runs automatically; there is no UI for it.

### Removed settings

The following settings no longer exist. Their behaviour is either always-on, fixed, or replaced
by the data model above:

| Removed                                                                                                                                                                                                                             | Replacement / new behaviour                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `providerOverrides`                                                                                                                                                                                                     | `defaultProvider`, `features.<feature>.provider`                                                                                                                                                |
| `chatModelName`, `summaryModelName`, `completionsModelName`, `imageModelName`, `ollamaModelName`, `ollamaSummaryModelName`, `ollamaCompletionsModelName`, `openaiModelName`, `openaiSummaryModelName`, `openaiCompletionsModelName` | `features.<feature>.model` + `providerModelMemory`                                                                                                                                              |
| `streamingEnabled`                                                                                                                                                                                                                  | Streaming is always on                                                                                                                                                                          |
| `useInteractionsApi`, `useInteractionsApiMigrated`                                                                                                                                                                                  | Gemini always uses the Interactions API                                                                                                                                                         |
| `temperature`, `topP`                                                                                                                                                                                                               | Removed everywhere — every request uses the provider SDK's own defaults. A session saved with a `temperature`/`top_p` frontmatter key keeps that key on disk, but it is never read or rewritten |
| `maxRetries`, `initialBackoffDelay`                                                                                                                                                                                                 | Fixed: 3 retries, 1000ms initial backoff (same defaults as before, no longer configurable)                                                                                                      |
| `loopDetectionEnabled`, `loopDetectionThreshold`, `loopDetectionTimeWindowSeconds`                                                                                                                                                  | Loop detection is always on, fixed at 3 identical calls within 30 seconds — see [Tool loop detection](/reference/loop-detection)                                                                |
| `mcpEnabled`                                                                                                                                                                                                                        | An empty `mcpServers` list means MCP is off; no separate toggle                                                                                                                                 |
| `expandedSettingsSections`                                                                                                                                                                                                          | No section-expand state to persist — sub-pages replace collapsible sections                                                                                                                     |

## Session-Level Settings

Session settings override global defaults for specific agent sessions. Access via the settings
icon in the session header.

### Model Configuration

- **Model**: Override the routed model for this session
- **Custom Prompt**: Select a custom prompt template for this session

### Context Files

- Add specific notes as persistent context for the session
- Context files are automatically included with every message
- Use @ mentions in chat to add files
- Active note is automatically included by default

### Permissions

Session-level permissions allow bypassing confirmation dialogs for specific operations during the
current session only.

Available permission bypasses:

- File creation
- File modification
- File deletion
- File moving/renaming

**Note**: Permissions reset when you create a new session or load a different session.

## Performance Considerations

- **Model Selection**: Flash models (8B, standard) are faster but less capable than Pro models
- **Model Discovery**: Minimal performance impact; runs in background
- **Loop Detection**: Negligible overhead; always on

## Security Best Practices

1. **API Key**: Your API key is stored securely via Obsidian's SecretStorage and is not written to `data.json`. Never share your API key or commit it to version control
2. **System Folders**: Plugin automatically protects Obsidian's configuration folder (`.obsidian` by default, or a renamed one) and plugin state folders from tool operations
3. **Tool permissions**: Review tool operations before approving (when confirmations are enabled)
4. **System Prompt Override**: Use with caution; can break expected functionality

## Troubleshooting

### Models not appearing

1. Check the provider's card on the Providers page shows "Connected."
2. For Gemini: click **Refresh** on the Gemini card, or run the **Gemini Scribe: Refresh model
   list** command. The auto-fetch runs at most once every 24 hours, so a freshly published model
   won't appear until the cache expires unless you force a refresh.
3. For Ollama: click **Refresh** on the Ollama card after pulling new models.
4. For OpenAI: click **Refresh** on the OpenAI card — useful after changing the base URL or
   loading a different model in a compatible server.
5. For Anthropic: click **Refresh** on the Anthropic card. Only curated Claude models are offered,
   and only those your key's organization can access.
6. Check console for errors (with Debug mode enabled).

### A feature shows a warning on the Features page

1. Open the feature's row — the displayed reason is either "Choose a provider" (the routed
   provider doesn't support this feature) or "not connected" (the provider supports it, but its
   credential or endpoint isn't set up).
2. Fix the underlying provider on the Providers page (add a key, fix the endpoint), or route the
   feature to a different provider, or leave it Off.

### Tool execution issues

1. Enable Debug mode and Log API calls to a file (Advanced → Diagnostics)
2. Review "Stop the agent when a tool fails" (Advanced)
3. Examine console logs or `debug.log` in the plugin folder for specific errors

### Chat history not saving

1. Verify "Keep session history" is toggled on
2. Check the Plugin folder path is valid
3. Ensure you have write permissions to vault

For more help, see the [Getting Started Guide](/guide/getting-started) or [open an issue](https://github.com/allenhutchison/obsidian-gemini/issues).
