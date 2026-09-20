# Provider Capabilities

Gemini Scribe can run on the **Google Gemini (cloud)**, **Ollama** (models pulled to your machine, plus optional Ollama cloud models), **OpenAI (cloud)**, or **Anthropic (cloud)** provider. Connect one or more providers on the Providers page, pick a **default provider** for anything you haven't routed elsewhere, and route individual features to a specific provider on the [Features page](/reference/settings#features). Some features depend on Gemini-specific cloud APIs and are unavailable on Ollama, OpenAI, and Anthropic. This page is the single source of truth for what works where; `docs/guide/ollama-setup.md`, `docs/guide/openai-setup.md`, and `docs/guide/anthropic-setup.md` link here instead of duplicating the table.

## Capability matrix

| Feature                         | Gemini | Ollama                                                                              | OpenAI                                           | Anthropic                          |
| ------------------------------- | :----: | ----------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| Chat                            |   ✓    | ✓                                                                                   | ✓                                                | ✓                                  |
| Tool calling (agent mode)       |   ✓    | ✓ (model-dependent)                                                                 | ✓ (model-dependent on compatible servers)        | ✓                                  |
| Vision (image attachments)      |   ✓    | ✓ (model-dependent, auto-detected)                                                  | ✓ (model-dependent, auto-detected)               | ✓                                  |
| Scheduled tasks                 |   ✓    | ✓ (inherits the model's tool/vision limits)                                         | ✓ (inherits the model's tool/vision limits)      | ✓                                  |
| Summaries                       |   ✓    | ✓                                                                                   | ✓                                                | ✓                                  |
| Completions                     |   ✓    | ✓                                                                                   | ✓                                                | ✓                                  |
| Rewrite                         |   ✓    | ✓                                                                                   | ✓                                                | ✓                                  |
| RAG / Vault Semantic Search     |   ✓    | ✗ — tracked in [#705](https://github.com/allenhutchison/obsidian-gemini/issues/705) | ✗                                                | ✗                                  |
| Image generation                |   ✓    | ✗ — tracked in [#706](https://github.com/allenhutchison/obsidian-gemini/issues/706) | ✓ (GPT Image via the Images API)                 | ✗                                  |
| Google Search grounding         |   ✓    | ✗                                                                                   | ✗                                                | ✗                                  |
| Google Maps grounding           |   ✓    | ✗                                                                                   | ✗                                                | ✗                                  |
| URL Context (web fetch tool)    |   ✓    | ✗                                                                                   | ✗                                                | ✗                                  |
| Deep Research                   |   ✓    | ✗                                                                                   | ✗                                                | ✗                                  |
| PDF / audio / video attachments |   ✓    | ✗ (images only)                                                                     | ✗ (images only)                                  | ✗ (images and PDF; no audio/video) |
| Custom base URL                 |   ✓    | ✗ (uses its own `ollamaBaseUrl` setting)                                            | ✓ (also targets OpenAI-compatible local servers) | ✗                                  |

OpenAI's row covers both the real `api.openai.com` endpoint (billed with your own OpenAI API key) and any OpenAI-compatible server reachable at a custom base URL — LM Studio, an MLX-served endpoint, Ollama's own OpenAI-compatible endpoint, and similar. See the [OpenAI Setup Guide](/guide/openai-setup) for both paths. This is API-key billing only — there is no "Sign in with ChatGPT" / ChatGPT-subscription auth.

Anthropic's column covers Claude models on `api.anthropic.com`, billed with your own Anthropic API key. It has no custom base URL. Offered models report their own context window (1M tokens for all but Haiku 4.5's 200k); 200k is the fallback for a model the list can't identify. Token counts are estimated rather than fetched from a counting endpoint. See the [Anthropic Setup Guide](/guide/anthropic-setup).

## Features page

On the [Features page](/reference/settings#features), each of these is routed independently,
shown as a `<provider> · <model>` row:

| Row                | Covers                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| Chat and agent     | Interactive chat, agent sessions, scheduled tasks, hooks                            |
| Summaries          | The "Summarize active file" command and conversation compaction                     |
| Completions        | IDE-style inline suggestions                                                        |
| Rewrite            | Rewriting selected text — has its own model field, no longer borrows the chat model |
| Web search         | Google Search grounding and URL Context (web fetch)                                 |
| Deep research      | The Deep Research managed agent (no model field of its own)                         |
| Vault search index | Semantic search across your vault (RAG; no model field of its own)                  |
| Image generation   | Generating images from a prompt                                                     |

Opening a row gives exactly two controls: a provider dropdown (listing only providers that
actually support that feature, plus an explicit **Off**) and, where the feature has a model, a
model dropdown filtered to that provider. Chat and agent, Summaries, Completions, and Rewrite
each list Gemini, Ollama, OpenAI, and Anthropic. Image generation lists Gemini and OpenAI; Web
search, Deep research, and Vault search index list Gemini only today.

**Google Maps grounding is not on this page.** It's provider-bound to Gemini and listed under
the Gemini provider card's "Includes" line instead — see [Provider-bound grounding](#provider-bound-grounding)
below.

This is what makes a mixed setup work: run chat locally on Ollama for privacy and speed, but keep Gemini for web search and image generation — or run chat and image generation on OpenAI while keeping Gemini for Google-backed tools. Each feature makes its own provider call rather than riding on the chat request, so its credential and destination follow that feature's route.

### Provider-bound grounding

Google Maps grounding and Gemini's URL-context surface are **provider-bound**, not routed
features: `google_maps` registers whenever the Gemini provider is configured, regardless of
which provider serves any Features row. Its model follows the Web search row's model when Web
search is on Gemini, otherwise the bundled Gemini chat default.

### Privacy semantics

**Nothing is ever routed to the cloud on your behalf.** If a feature's routed provider can't
serve it, or isn't connected, that feature stays **off** — the plugin does not quietly substitute
another provider. Turning on a cloud feature is always an explicit, per-feature choice, made on
the [Features page](/reference/settings#features).

Consequences worth knowing:

- Choosing Gemini for a feature means **that feature's requests — including any note content
  they send — go to Google.** The Providers page's privacy note names exactly which features are
  on a non-local provider.
- Choosing OpenAI for a feature means that feature's requests go to `api.openai.com` (or
  whatever base URL you've configured) instead. Choosing Anthropic sends them to
  `api.anthropic.com`.
- **Vault search index** is the broadest of these: enabling it uploads note content to a cloud
  file-search store, not just the text of a single request.
- Each provider card only needs its own credential: the Gemini card's API key is required only
  once some feature is actually routed to Gemini (not only when Gemini is your default provider);
  the OpenAI and Anthropic cards' API key fields work the same way for their providers.
- With every feature on Ollama and every selected model pulled locally, nothing leaves your
  machine — the Providers page shows Ollama as the only connected provider and the privacy note
  is empty. Pointing the OpenAI provider's base URL at a local OpenAI-compatible server (LM
  Studio, MLX, ...) achieves the same thing for OpenAI-routed features — the request never leaves
  your machine even though the provider is "OpenAI".
- Ollama can also serve **cloud-hosted models** (`gpt-oss:120b-cloud`, `deepseek-v4-pro:cloud`, …),
  which reach the daemon like local ones but run on ollama.com. Selecting one for any
  Ollama-served feature means requests for that feature leave your machine even though the
  provider is "Ollama" — provider alone no longer implies on-device execution. Detection uses the
  `remote_host` field Ollama reports for these entries, not the model name. See
  [Cloud models](/guide/ollama-setup#cloud-models).

### Models

Each model dropdown on the Features page lists the models of the provider serving that feature,
so a chat-on-Ollama / summaries-on-Gemini setup offers the right models in each row.

Ollama keeps one model resident at a time, so its summary and completions rows default to
**Same as chat model**. Choosing a distinct model there is supported but means Ollama reloads a
model on every switch — worth it for a small, fast completions model, rarely worth it otherwise.
OpenAI has no such constraint: each feature resolves its own default model when left on "Default
for this provider" (chat, summaries, and completions each have a different OpenAI default), and
switching between them costs nothing extra. Anthropic works the same way (Opus 5 for chat and
rewrite, Sonnet 5 for summaries, Haiku 4.5 for completions).

## Notes

- **Tool calling** — Whether an Ollama model can call tools depends on the model itself; most modern instruct models (Llama 3.2, Qwen 2.5, Mistral 0.3, …) support it, smaller or older models may not. OpenAI's offered chat models support tool calling; its dedicated image models do not use that path. All offered Claude models support tools.
- **Vision** — Ollama vision support is auto-detected per model from its `/api/show` capabilities (with a template/name-hint fallback for older Ollama versions) — no manual configuration is needed when you pull a new multimodal model. OpenAI vision support is auto-detected from a curated metadata map for known OpenAI model ids; an unrecognized model id (typically one served by an OpenAI-compatible server) defaults to no vision.
- **Model discovery** — The Ollama picker is built from the daemon's `/api/tags`, which lists locally pulled models only. A cloud model must be pulled before it appears, even if you already use it from the Ollama app or CLI. The cloud tag takes one of two forms depending on whether the model carries a size tag — `ollama pull gpt-oss:120b-cloud` but `ollama pull glm-5.2:cloud`; see [Cloud models](/guide/ollama-setup#cloud-models) for the exact syntax per model. The OpenAI picker is built from `GET <openaiBaseUrl>/models`, enriched with curated metadata (context window, vision support, and image-generation support) for current OpenAI models; unrecognized ids — including everything from a compatible server — get a conservative text-model default (128k context, no vision, tool calling assumed). Click **Refresh** on the OpenAI provider card after a compatible server's catalog changes.
- **RAG, Google Search, Google Maps, URL Context, and Deep Research** call Google's cloud APIs directly and require a Gemini API key. Image generation calls either Google or OpenAI according to its feature route. Their agent tools are only registered when the corresponding feature is routed to a provider that supports them; RAG's indexing service isn't initialized otherwise. What stays visible either way is the command palette and settings UI: the **Generate image** command, the RAG **Pause/Resume/Show status** commands, and the **Vault search index** page remain in place, but invoking one while its feature has no provider shows a notice pointing at the Features page rather than failing the call.
- **Scheduled tasks** run through the same chat/tool-calling path as interactive agent sessions, so a task that needs vision or tool calling on Ollama or OpenAI is still bound by that model's capabilities.
- **Context limits and token counting** follow the model in hand, not a global setting — a Gemini model is counted through Google's `countTokens` endpoint against a 1M-token window, while a local, OpenAI, or Anthropic model uses a calibrated chars-per-token estimate against that model's own window. In a mixed setup each applies to its own model.
- **Ollama context window** — Resolved per model from the daemon rather than assumed: the runtime allocation from `/api/ps` when the model is loaded, the model's advertised maximum from `/api/show` before that, and a conservative 32k fallback only when the daemon is unreachable. This matters because Ollama's own default window is VRAM-derived (4k under 24 GiB) and often a small fraction of what the model supports — see [Set the context window first](/guide/ollama-setup#set-the-context-window-first).
- **OpenAI reasoning** — the Chat Completions API doesn't return model "thinking" the way Gemini and Ollama can, so no reasoning is shown for `api.openai.com`. A compatible server that emits a `reasoning_content` field on its responses will have that content shown as thoughts, same as the other providers.
- **Anthropic reasoning** — Claude models other than Haiku 4.5 run with adaptive thinking, and a summary of that reasoning is shown as thoughts. Opus 5 and Fable 5.1 also opt into Anthropic's server-side refusal fallback — see the [Anthropic Setup Guide](/guide/anthropic-setup#how-requests-are-made).

Changing the default provider or any feature's provider takes effect immediately — no data is lost, and each provider's model choices persist across changes (`providerModelMemory` restores the model you had the last time a feature was on that provider).

See the [Ollama Setup Guide](/guide/ollama-setup), the [OpenAI Setup Guide](/guide/openai-setup), and the [Anthropic Setup Guide](/guide/anthropic-setup) for installation/configuration steps and provider-specific tips.
