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
3. **Switch the provider in Gemini Scribe** — Open Settings → Gemini Scribe → Provider and choose **Ollama (local)**. This sets the _default_ provider, which every feature uses unless you override it.
4. **Pick a model** — The **Ollama model** picker lists whatever you have pulled and serves chat and rewrite. Summaries and completions default to **Same as chat model**, because Ollama keeps only one model resident at a time and a second model is reloaded on every switch. In Settings → General, click **Refresh** in the **Refresh Ollama model list** row if a new pull doesn't show up.

If the daemon runs on a different host or port, edit the **Ollama base URL** field (e.g. `http://10.0.0.5:11434`).

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision models (e.g. `llava`, `moondream`, `qwen2.5-vl`); vision support is auto-detected from the model's reported capabilities via `/api/show`
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers

## What does not work locally

Google Search, Google Maps, URL Context (web fetch), Deep Research, image generation, and the vault search index all depend on Gemini cloud services. With Ollama as your default provider they are switched off, and the settings show a **Local-only feature notice** confirming nothing leaves your machine. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix and the reasons behind each gap.

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
- **Context window** — Local models often have smaller context than Gemini. Compaction triggers at the percentage set by `Context Compaction Threshold` (default `20`%) of an estimated 32k-token window; long sessions will summarize older turns earlier than they do on Gemini.
- **Token counts** — Ollama does not expose a `countTokens` endpoint, so the plugin estimates tokens from character length, starting at a chars ÷ 4 default and calibrating a per-model ratio from each response's real token counts as the session progresses. The token-usage indicator is approximate early in a session and becomes more accurate after the first few turns with a given model.
- **Daemon down?** — If the daemon stops, agent calls will surface a "Could not connect to the Ollama daemon" notice. Restart with `ollama serve` and click **Refresh Ollama model list**.
