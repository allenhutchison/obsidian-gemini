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
3. **Switch the provider in Gemini Scribe** — Open Settings → Gemini Scribe → Provider and choose **Ollama (local)**.
4. **Pick a model** — Under Ollama the settings show a single **Ollama model** picker (one model serves chat, summary, completions, and rewrite — Ollama keeps only one model resident at a time, so per-use-case models would just thrash memory). It lists whatever you have pulled. In Settings → General, click **Refresh** in the **Refresh model list** row if a new pull doesn't show up.

If the daemon runs on a different host or port, edit the **Ollama base URL** field (e.g. `http://10.0.0.5:11434`).

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision models (e.g. `llava`, `moondream`, `qwen2.5-vl`); vision support is auto-detected from the model's reported capabilities via `/api/show`
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers

## What does not work in Phase 1

These features depend on Gemini built-in services and are hidden when Ollama is the active provider. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full Gemini-vs-Ollama matrix and the reasons behind each gap.

Switching back to Gemini at any time restores all features — settings persist across switches.

## Tips

- **Vision model detection** — Vision capability is auto-detected from each model's `/api/show` response. Any model that Ollama reports as vision-capable is enabled for image attachments automatically; you do not need to add new keywords or update settings when pulling a new multimodal model.
- **Tool calling** — Most modern instruct models support function calling; older or very small models may not. If the agent loop stalls, try a different model (Llama 3.2, Qwen 2.5, Mistral 0.3 are good starting points).
- **Context window** — Local models often have smaller context than Gemini. Compaction triggers at the percentage set by `Context Compaction Threshold` (default `20`%) of an estimated 32k-token window; long sessions will summarize older turns earlier than they do on Gemini.
- **Token counts** — Ollama does not expose a `countTokens` endpoint, so the plugin estimates tokens from character length, starting at a chars ÷ 4 default and calibrating a per-model ratio from each response's real token counts as the session progresses. The token-usage indicator is approximate early in a session and becomes more accurate after the first few turns with a given model.
- **Daemon down?** — If the daemon stops, agent calls will surface a "Could not connect to the Ollama daemon" notice. Restart with `ollama serve` and click **Refresh model list**.
