# Provider Capabilities

Gemini Scribe can run on either the **Google Gemini (cloud)** or **Ollama (local)** provider, set globally in Settings → Gemini Scribe → Provider. Some features depend on Gemini-specific cloud APIs and are unavailable when Ollama is active. This page is the single source of truth for what works where; `docs/guide/ollama-setup.md` links here instead of duplicating the table.

> Today the provider choice is a single global setting — there is no per-feature override (e.g. "chat on Ollama, search on Gemini" in the same session). Per-use-case provider selection is tracked in [#704](https://github.com/allenhutchison/obsidian-gemini/issues/704).

## Capability matrix

| Feature                         | Gemini | Ollama                                                                              |
| ------------------------------- | :----: | ----------------------------------------------------------------------------------- |
| Chat                            |   ✓    | ✓                                                                                   |
| Tool calling (agent mode)       |   ✓    | ✓ (model-dependent)                                                                 |
| Vision (image attachments)      |   ✓    | ✓ (model-dependent, auto-detected)                                                  |
| Scheduled tasks                 |   ✓    | ✓ (inherits the model's tool/vision limits)                                         |
| RAG / Vault Semantic Search     |   ✓    | ✗ — tracked in [#705](https://github.com/allenhutchison/obsidian-gemini/issues/705) |
| Image generation                |   ✓    | ✗ — tracked in [#706](https://github.com/allenhutchison/obsidian-gemini/issues/706) |
| Google Search grounding         |   ✓    | ✗                                                                                   |
| Google Maps grounding           |   ✓    | ✗                                                                                   |
| URL Context (web fetch tool)    |   ✓    | ✗                                                                                   |
| Deep Research                   |   ✓    | ✗                                                                                   |
| PDF / audio / video attachments |   ✓    | ✗ (images only)                                                                     |

## Notes

- **Tool calling** — Whether an Ollama model can call tools depends on the model itself; most modern instruct models (Llama 3.2, Qwen 2.5, Mistral 0.3, …) support it, smaller or older models may not.
- **Vision** — Ollama vision support is auto-detected per model from its `/api/show` capabilities (with a template/name-hint fallback for older Ollama versions) — no manual configuration is needed when you pull a new multimodal model.
- **RAG, image generation, Google Search, Google Maps, URL Context, and Deep Research** all call Google's cloud APIs directly and require a Gemini API key regardless of the active provider setting. All six are hidden from the agent's tool list when Ollama is selected — none of these tools are registered while Ollama is the active provider (RAG's indexing service isn't initialized either). What does stay visible under Ollama is the command palette and settings UI: the **Generate image** command, the RAG **Pause/Resume/Show status** commands, and the **Vault search index** settings toggle remain in place, but invoking any of them shows a clear "not available" notice rather than failing the call or silently doing nothing.
- **Scheduled tasks** run through the same chat/tool-calling path as interactive agent sessions, so a task that needs vision or tool calling on Ollama is still bound by that model's capabilities.

Switching the **Provider** setting between Gemini and Ollama at any time restores or hides the Google-only tools immediately — no data is lost, and settings persist across switches.

See the [Ollama Setup Guide](/guide/ollama-setup) for installation steps and local-model tips.
