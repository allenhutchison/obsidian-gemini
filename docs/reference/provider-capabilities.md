# Provider Capabilities

Gemini Scribe can run on the **Google Gemini (cloud)**, **Ollama (local)**, or **OpenAI (cloud)** provider. You pick a **default provider** in Settings → Gemini Scribe → Provider, and — since per-feature provider selection landed — you can point individual features at a different provider from there. Some features depend on Gemini-specific cloud APIs and are unavailable on Ollama and OpenAI. This page is the single source of truth for what works where; `docs/guide/ollama-setup.md` and `docs/guide/openai-setup.md` link here instead of duplicating the table.

## Capability matrix

| Feature                         | Gemini | Ollama                                                                              | OpenAI                                           |
| ------------------------------- | :----: | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Chat                            |   ✓    | ✓                                                                                   | ✓                                                |
| Tool calling (agent mode)       |   ✓    | ✓ (model-dependent)                                                                 | ✓ (model-dependent on compatible servers)        |
| Vision (image attachments)      |   ✓    | ✓ (model-dependent, auto-detected)                                                  | ✓ (model-dependent, auto-detected)               |
| Scheduled tasks                 |   ✓    | ✓ (inherits the model's tool/vision limits)                                         | ✓ (inherits the model's tool/vision limits)      |
| Summaries                       |   ✓    | ✓                                                                                   | ✓                                                |
| Completions                     |   ✓    | ✓                                                                                   | ✓                                                |
| Rewrite                         |   ✓    | ✓                                                                                   | ✓                                                |
| RAG / Vault Semantic Search     |   ✓    | ✗ — tracked in [#705](https://github.com/allenhutchison/obsidian-gemini/issues/705) | ✗                                                |
| Image generation                |   ✓    | ✗ — tracked in [#706](https://github.com/allenhutchison/obsidian-gemini/issues/706) | ✗                                                |
| Google Search grounding         |   ✓    | ✗                                                                                   | ✗                                                |
| Google Maps grounding           |   ✓    | ✗                                                                                   | ✗                                                |
| URL Context (web fetch tool)    |   ✓    | ✗                                                                                   | ✗                                                |
| Deep Research                   |   ✓    | ✗                                                                                   | ✗                                                |
| PDF / audio / video attachments |   ✓    | ✗ (images only)                                                                     | ✗ (images only)                                  |
| Custom base URL                 |   ✓    | ✗ (uses its own `ollamaBaseUrl` setting)                                            | ✓ (also targets OpenAI-compatible local servers) |

OpenAI's row covers both the real `api.openai.com` endpoint (billed with your own OpenAI API key) and any OpenAI-compatible server reachable at a custom base URL — LM Studio, an MLX-served endpoint, Ollama's own OpenAI-compatible endpoint, and similar. See the [OpenAI Setup Guide](/guide/openai-setup) for both paths. This is API-key billing only — there is no "Sign in with ChatGPT" / ChatGPT-subscription auth.

## Per-feature provider selection

Under **Settings → Gemini Scribe → Per-feature provider**, each of these can be routed independently:

| Row                | Covers                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| Chat and agent     | Interactive chat, agent sessions, scheduled tasks, hooks                 |
| Summaries          | The "Summarize active file" command and conversation compaction          |
| Completions        | IDE-style inline suggestions                                             |
| Rewrite            | Rewriting selected text (uses the chat model)                            |
| Web and search     | Google Search, Google Maps, URL Context (web fetch), Deep Research tools |
| Vault search index | Semantic search across your vault (RAG)                                  |
| Image generation   | Generating images from a prompt                                          |

Every row defaults to **Default (\<your provider\>)**. A dropdown only lists providers that actually support that feature, so the Image generation and Vault search index rows offer Gemini only — they're shown disabled when your default provider is the only candidate, which makes the capability gap visible rather than silently missing. Chat and agent, Summaries, Completions, and Rewrite each list Gemini, Ollama, and OpenAI.

This is what makes a mixed setup work: run chat locally on Ollama for privacy and speed, but keep Gemini for web search and image generation — or run chat on OpenAI (or an OpenAI-compatible server) while keeping Gemini for the cloud-only tools. The cloud-only tools each make their own call to Google's API rather than riding on the chat request, so they work regardless of which provider serves chat — they only need a Gemini API key.

### Privacy semantics

**Nothing is ever routed to the cloud on your behalf.** If your default provider can't serve a feature, that feature stays **off** — the plugin does not quietly substitute another provider. Turning on a cloud feature is always an explicit, per-feature choice.

Consequences worth knowing:

- Choosing Gemini for a feature means **that feature's requests — including any note content they send — go to Google.** The settings UI shows a "Some features use a different provider" notice listing exactly which ones whenever this is the case.
- Choosing OpenAI for a feature means that feature's requests go to `api.openai.com` (or whatever base URL you've configured) instead.
- **Vault search index** is the broadest of these: enabling it uploads note content to a cloud file-search store, not just the text of a single request.
- The **API key** field appears whenever _any_ feature is routed to Gemini, not only when Gemini is your default; the same is true of the **OpenAI API key** field for OpenAI.
- With every feature on Ollama and every selected model pulled locally, the settings show the "Local-only feature notice" and nothing leaves your machine. Pointing the OpenAI provider's base URL at a local OpenAI-compatible server (LM Studio, MLX, ...) achieves the same thing for OpenAI-routed features — the request never leaves your machine even though the provider is "OpenAI".
- Ollama can also serve **cloud-hosted models** (`gpt-oss:120b-cloud`, `deepseek-v4-pro:cloud`, …), which reach the daemon like local ones but run on ollama.com. Selecting one for any Ollama-served feature replaces the local-only reassurance with a "Cloud-hosted model notice" naming the model and host — provider alone no longer implies on-device execution. Detection uses the `remote_host` field Ollama reports for these entries, not the model name. See [Cloud models](/guide/ollama-setup#cloud-models).

### Models

Each model dropdown lists the models of the provider serving that feature, so a chat-on-Ollama / summaries-on-Gemini setup offers the right models in each row.

Ollama keeps one model resident at a time, so its summary and completions pickers default to **Same as chat model**. Choosing a distinct model there is supported but means Ollama reloads a model on every switch — worth it for a small, fast completions model, rarely worth it otherwise. OpenAI has no such constraint: each use case gets its own default model (currently `gpt-5.6` for chat, `gpt-5.6-terra` for summaries, `gpt-5.6-luna` for completions) and switching between them costs nothing extra.

## Notes

- **Tool calling** — Whether an Ollama model can call tools depends on the model itself; most modern instruct models (Llama 3.2, Qwen 2.5, Mistral 0.3, …) support it, smaller or older models may not. OpenAI's current models all support tool calling.
- **Vision** — Ollama vision support is auto-detected per model from its `/api/show` capabilities (with a template/name-hint fallback for older Ollama versions) — no manual configuration is needed when you pull a new multimodal model. OpenAI vision support is auto-detected from a curated metadata map for known OpenAI model ids; an unrecognized model id (typically one served by an OpenAI-compatible server) defaults to no vision.
- **Model discovery** — The Ollama picker is built from the daemon's `/api/tags`, which lists locally pulled models only. A cloud model must be pulled before it appears, even if you already use it from the Ollama app or CLI. The cloud tag takes one of two forms depending on whether the model carries a size tag — `ollama pull gpt-oss:120b-cloud` but `ollama pull glm-5.2:cloud`; see [Cloud models](/guide/ollama-setup#cloud-models) for the exact syntax per model. The OpenAI picker is built from `GET <openaiBaseUrl>/models`, enriched with curated metadata (context window, vision support) for current OpenAI models; unrecognized ids — including everything from a compatible server — get a conservative default (128k context, no vision, tool calling assumed). Click **Refresh OpenAI model list** after a compatible server's catalog changes.
- **RAG, image generation, Google Search, Google Maps, URL Context, and Deep Research** all call Google's cloud APIs directly and require a Gemini API key. Their agent tools are only registered when the corresponding feature is routed to a provider that supports them; RAG's indexing service isn't initialized otherwise. What stays visible either way is the command palette and settings UI: the **Generate image** command, the RAG **Pause/Resume/Show status** commands, and the **Vault search index** settings toggle remain in place, but invoking one while its feature has no provider shows a notice pointing at the Per-feature provider settings rather than failing the call.
- **Scheduled tasks** run through the same chat/tool-calling path as interactive agent sessions, so a task that needs vision or tool calling on Ollama or OpenAI is still bound by that model's capabilities.
- **Context limits and token counting** follow the model in hand, not a global setting — a Gemini model is counted through Google's `countTokens` endpoint against a 1M-token window, while a local or OpenAI model uses a calibrated chars-per-token estimate. In a mixed setup each applies to its own model.
- **Ollama context window** — Resolved per model from the daemon rather than assumed: the runtime allocation from `/api/ps` when the model is loaded, the model's advertised maximum from `/api/show` before that, and a conservative 32k fallback only when the daemon is unreachable. This matters because Ollama's own default window is VRAM-derived (4k under 24 GiB) and often a small fraction of what the model supports — see [Set the context window first](/guide/ollama-setup#set-the-context-window-first).
- **OpenAI reasoning** — the Chat Completions API doesn't return model "thinking" the way Gemini and Ollama can, so no reasoning is shown for `api.openai.com`. A compatible server that emits a `reasoning_content` field on its responses will have that content shown as thoughts, same as the other providers.

Changing the default provider or any per-feature provider takes effect immediately — no data is lost, and each provider's model choices persist across changes.

See the [Ollama Setup Guide](/guide/ollama-setup) and the [OpenAI Setup Guide](/guide/openai-setup) for installation/configuration steps and provider-specific tips.
