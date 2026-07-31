# Ollama (Local Models)

Gemini Scribe can route chat, summary, completions, rewrite, and agent tool-calling through a local [Ollama](https://ollama.com) daemon instead of the Google Gemini API. Use this when you want offline operation, full data privacy, or to avoid API quota limits.

## Setup

1. **Install Ollama** — Download the installer from [ollama.com](https://ollama.com/download) and run it. The daemon listens on `http://localhost:11434` by default.
2. **Pull a model** — In a terminal, fetch any model that supports tool calling:
   ```bash
   ollama pull llama3.2
   ollama pull qwen2.5:7b
   ollama pull llava:13b      # for vision (image input)
   ```
3. **Raise Ollama's context window** — Do this before anything else; the default is too small for agent mode. See [Set the context window first](#set-the-context-window-first).
4. **Switch the provider in Gemini Scribe** — Open Settings → Gemini Scribe → Provider and choose **Ollama (local)**. This sets the _default_ provider, which every feature uses unless you override it.
5. **Pick a model** — The **Ollama model** picker lists whatever you have pulled and serves chat and rewrite. Summaries and completions default to **Same as chat model**, because Ollama keeps only one model resident at a time and a second model is reloaded on every switch. In Settings → General, click **Refresh** in the **Refresh Ollama model list** row if a new pull doesn't show up.

If the daemon runs on a different host or port, edit the **Ollama base URL** field (e.g. `http://10.0.0.5:11434`).

## Set the context window first

**This is the single most common cause of bad results with Ollama.** Set the window as large as your hardware allows — at minimum 64k, and 256k if you can.

Ollama does not use the model's full context by default. It picks a window from your available VRAM:

| Available VRAM | Ollama's default window |
| -------------- | ----------------------- |
| Under 24 GiB   | **4,000 tokens**        |
| 24–48 GiB      | 32,000 tokens           |
| 48 GiB and up  | 256,000 tokens          |

Most machines land in that first row. 4,000 tokens is not enough to hold the agent's system prompt and tool definitions plus your note content, so the prompt gets truncated before the model ever sees your question. The model then answers from whatever fragment survived — which looks like the agent ignoring your vault and inventing files that don't exist ([#1252](https://github.com/allenhutchison/obsidian-gemini/issues/1252)). Nothing in the plugin's settings can compensate; the window has to be raised in Ollama itself.

Note this is independent of the model: pulling a model that advertises a 262k context still gets you a 4k window if that's what your VRAM tier allows.

**Desktop app** — Open Ollama's settings and drag the context length slider up.

**Running `ollama serve` yourself** — Set the environment variable:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

To make it permanent on macOS or Linux, export it from your shell profile; on Windows, add it under System Properties → Environment Variables and restart Ollama.

**Verify it took effect** — Send one message to the model, then check what the daemon actually allocated:

```bash
curl -s http://localhost:11434/api/ps
```

The `context_length` in the response is your real window. Gemini Scribe reads the same value, so the token counter under the agent input shows the true window and compacts against it — if the counter says 4,000, Ollama is still on its default.

The tradeoff is memory: a larger window costs more RAM/VRAM and slows generation. If Ollama fails to load a model after raising it, step the value down.

## Cloud models

Ollama can also run large models on its own servers — `gpt-oss:120b-cloud`, `deepseek-v4-pro:cloud`, and similar. These reach the plugin like local models (same daemon, same API, same auto-detected capabilities), but the inference happens on ollama.com.

Tool calling and vision still depend on the model you pick, exactly as they do locally — being cloud-hosted grants neither. Most current cloud models report tool support, but vision is common to skip: of the models available here, `kimi-k2.7-code:cloud` and `qwen3.5:397b-cloud` report vision while the larger `deepseek-v4-pro:cloud` and `glm-5.2:cloud` do not, so image attachments fail on the latter. The picker reflects whatever `/api/show` reports for each model.

**You must pull a cloud model before the plugin can see it.** This is the part that trips people up: running a cloud model from the Ollama desktop app or via `ollama run` does _not_ register it locally. The plugin builds its model list from the daemon's `/api/tags` endpoint, which only reports models that have a local manifest — so a cloud model you've been happily using elsewhere will still be missing from the picker.

To make one selectable:

1. Sign in once with `ollama signin`.
2. Pull the model. This downloads only a small manifest, not the weights:
   ```bash
   ollama pull deepseek-v4-pro:cloud
   ```
3. Click **Refresh** in the **Refresh Ollama model list** row in Settings → General.

Mind the tag format — it differs depending on whether the model has a size tag:

| Model                  | Cloud name                   | Rule                                |
| ---------------------- | ---------------------------- | ----------------------------------- |
| `gpt-oss:120b`         | `gpt-oss:120b-cloud`         | tagged → append `-cloud` to the tag |
| `mistral-large-3:675b` | `mistral-large-3:675b-cloud` | tagged → append `-cloud` to the tag |
| `deepseek-v4-pro`      | `deepseek-v4-pro:cloud`      | untagged → `cloud` _is_ the tag     |
| `glm-5.2`              | `glm-5.2:cloud`              | untagged → `cloud` _is_ the tag     |

Guessing wrong gives `model 'name-cloud:latest' not found`. Run `ollama list` after pulling to confirm the exact name the plugin will show.

Two caveats:

- **A cloud model sends your notes to ollama.com.** Selecting one replaces the settings' **Local-only feature notice** with a **Cloud-hosted model notice** naming the model and host, so the reassurance is never shown while a remote model is in use. If you switched to Ollama for privacy, stay on locally pulled models.
- **Pulling doesn't guarantee access.** Some models are excluded from included plan usage. A pull always succeeds, but the first request fails with `this model uses extra usage only ... your extra usage balance is empty`. Check your plan at [ollama.com/settings](https://ollama.com/settings), or `ollama rm` the model so it stops appearing in the picker.

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision models (e.g. `llava`, `moondream`, `qwen2.5-vl`); vision support is auto-detected from the model's reported capabilities via `/api/show`
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers

## What does not work locally

Google Search, Google Maps, URL Context (web fetch), Deep Research, image generation, and the vault search index all depend on Gemini cloud services. With Ollama as your default provider they are switched off, and — as long as your selected models are pulled locally — the settings show a **Local-only feature notice** confirming nothing leaves your machine. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix and the reasons behind each gap.

Switching back to Gemini at any time restores all features — settings persist across changes.

## Mixed setup: local chat, cloud extras

You don't have to choose all-or-nothing. Under **Settings → Gemini Scribe → Per-feature provider**, each feature can be pointed at a different provider — so you can keep chat local while still using Gemini's web search or image generation.

To do that:

1. Set **Provider** to **Ollama (local)** as above.
2. Open the **Per-feature provider** section and set the features you want in the cloud — for example **Web and search** and **Image generation** — to **Google Gemini**.
3. Enter your Gemini **API key** in the field that appears. It's needed by any feature routed to Gemini, even though chat stays local.

Two things to keep in mind:

- **Nothing moves to the cloud unless you move it.** A feature your default provider can't serve stays off; the plugin never silently substitutes another provider.
- **A feature you route to Gemini sends its data to Google** — including note content, for tools that read your notes. The settings show a notice naming exactly which features are affected whenever any are. The **Vault search index** is the broadest of these: it uploads note content to a cloud search index rather than just the text of one request.

## Tips

- **Vision model detection** — Vision capability is auto-detected from each model's `/api/show` response. Any model that Ollama reports as vision-capable is enabled for image attachments automatically; you do not need to add new keywords or update settings when pulling a new multimodal model.
- **Tool calling** — Most modern instruct models support function calling; older or very small models may not. If the agent loop stalls, try a different model (Llama 3.2, Qwen 2.5, Mistral 0.3 are good starting points).
- **Context window** — The plugin reads the window the daemon actually allocated (`/api/ps`), falling back to the model's advertised maximum (`/api/show`) before its first load and to a conservative 32k only when the daemon can't be reached. Compaction triggers at the percentage set by `Context Compaction Threshold` (default `20`%) of that window, so raising Ollama's context length directly buys you longer sessions before summarization kicks in. See [Set the context window first](#set-the-context-window-first).
- **Token counts** — Ollama does not expose a `countTokens` endpoint, so the plugin estimates tokens from character length, starting at a chars ÷ 4 default and calibrating a per-model ratio from each response's real token counts as the session progresses. The token-usage indicator is approximate early in a session and becomes more accurate after the first few turns with a given model.
- **Daemon down?** — If the daemon stops, agent calls will surface a "Could not connect to the Ollama daemon" notice. Restart with `ollama serve` and click **Refresh Ollama model list**.
