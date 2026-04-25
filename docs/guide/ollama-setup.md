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
4. **Pick a model** — The Chat / Summary / Completion dropdowns now list whatever you have pulled. Click **Refresh** if a new pull doesn't show up.

If the daemon runs on a different host or port, edit the **Ollama Base URL** field (e.g. `http://10.0.0.5:11434`).

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision models (e.g. `llava`, `moondream`, `qwen2.5-vl`)
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers

## What does not work in Phase 1

These features depend on Gemini built-in services and are hidden when Ollama is the active provider:

| Feature                         | Why it's gated                         | Workaround                                  |
| ------------------------------- | -------------------------------------- | ------------------------------------------- |
| Google Search tool              | Uses Gemini's `googleSearch` grounding | Switch to Gemini for search-heavy sessions  |
| URL Context (web fetch)         | Uses Gemini's URL Context API          | Paste content into a note, then `read_file` |
| Deep Research                   | Built on Gemini multi-step search      | Switch to Gemini                            |
| Image generation                | Ollama has no image-generation API     | Switch to Gemini for image-gen              |
| RAG / Vault Search              | Uses Gemini File Search Store          | Future phase: Ollama embeddings             |
| PDF / audio / video attachments | Ollama only accepts images             | Convert to image or text first              |

Switching back to Gemini at any time restores all features — settings persist across switches.

## Tips

- **Tool calling** — Most modern instruct models support function calling; older or very small models may not. If the agent loop stalls, try a different model (Llama 3.2, Qwen 2.5, Mistral 0.3 are good starting points).
- **Context window** — Local models often have smaller context than Gemini. Compaction triggers at 70% of an estimated 32k-token window by default; long sessions will summarise older turns more aggressively than they do on Gemini.
- **Token counts** — Ollama does not expose a `countTokens` endpoint, so the plugin estimates tokens from character length (chars ÷ 4). The token-usage indicator is approximate.
- **Daemon down?** — If the daemon stops, agent calls will surface a "Could not connect to the Ollama daemon" notice. Restart with `ollama serve` and click **Refresh model list**.
