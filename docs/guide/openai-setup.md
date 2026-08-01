# OpenAI

Gemini Scribe can route chat, summary, completions, rewrite, and agent tool-calling through the **OpenAI Chat Completions API** instead of the Google Gemini API. Use this when you already pay for OpenAI models, or when you want to point the plugin at an **OpenAI-compatible server** — LM Studio, an MLX-served endpoint, Ollama's own OpenAI-compatible endpoint, or similar — running locally or on your network.

This is API-key billing only: there is no "Sign in with ChatGPT" / ChatGPT-subscription (Codex-style) authentication. You need an OpenAI API key, or a placeholder key for a compatible server that doesn't check one.

## Setup

1. **Get an API key** — Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys), create a key, and copy it. If you're only targeting a local compatible server that doesn't validate keys, you can skip this and use any placeholder value instead — the provider still requires a key to be set.
2. **Switch the provider in Gemini Scribe** — Open Settings → Gemini Scribe → Provider and choose **OpenAI (cloud)**. This sets the _default_ provider, which every feature uses unless you override it.
3. **Enter your API key** — In the **OpenAI API key** field, click "Link..." and paste your key (or your placeholder value, for a compatible server). It's stored securely using Obsidian's SecretStorage, the same as the Gemini key.
4. **Pick models** — Chat, summary, and completions each get their own model dropdown, populated from `GET <OpenAI base URL>/models`. Unlike Ollama, OpenAI has no single-resident-model constraint, so picking a different model per use case costs nothing extra. Click **Refresh OpenAI model list** in Settings → General if a model doesn't show up.

If you're using the real OpenAI API, that's it — the base URL defaults to `https://api.openai.com/v1` and you're done.

## Using an OpenAI-compatible server

Point the **OpenAI base URL** field at your server instead of the default, and the plugin talks to it the same way it talks to OpenAI.

Example with [LM Studio](https://lmstudio.ai/):

1. Start LM Studio's local server (Developer tab → Start Server). By default it listens on `http://localhost:1234/v1`.
2. In Gemini Scribe, set **OpenAI base URL** to `http://localhost:1234/v1`.
3. LM Studio doesn't check API keys, but the plugin still requires the **OpenAI API key** field to be non-empty — enter any placeholder value (e.g. `lm-studio`).
4. Click **Refresh OpenAI model list** to pull in whatever model you have loaded in LM Studio.

The same pattern works for MLX-served endpoints, Ollama's OpenAI-compatible endpoint (`http://localhost:11434/v1`), or any other server that implements the `/v1/chat/completions` and `/v1/models` endpoints.

A compatible server's `/models` catalog is taken at face value — the supported-model allowlist described below applies only to `api.openai.com`.

## Models

- **`api.openai.com`** — the endpoint advertises around ninety model ids, most of which this integration can't drive usefully (Responses-API-only, audio, embeddings, older families). The dropdowns are therefore limited to the three GPT-5.6 models that have been validated against the plugin: **`gpt-5.6-sol`** (chat default), **`gpt-5.6-terra`** (summary default), and **`gpt-5.6-luna`** (completions default). All three accept **922,000 input tokens**, which is what the token counter above the message box reflects.
- **Where those numbers come from** — OpenAI's `/v1/models` returns no capability metadata (just an id and a creation date), so context windows are curated in the plugin rather than discovered. The 922,000 figure was measured directly against the live API, not taken from documentation.
- **Compatible servers** — an unrecognized model id gets a conservative default: 128k context window, no vision, tool calling assumed. This covers most locally-served models correctly for tool calling, but vision won't be enabled automatically — there's no metadata to detect it from.

### Reasoning and tool calling on GPT-5.6

The GPT-5.6 models are reasoning models, which constrains what Chat Completions accepts:

- **Sampling settings are ignored.** These models only accept the default temperature and top-p, so the plugin omits both rather than sending your configured values. Adjusting the temperature slider has no effect on a GPT-5.6 model.
- **Tool calling runs with reasoning disabled.** `/v1/chat/completions` rejects function tools for these models unless reasoning effort is set to `none`, so any request carrying tools (all agent-mode turns) pins it there. Agent mode works normally; you just won't get reasoning output alongside tool use.

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision-capable models (auto-detected for known OpenAI models; off by default for unrecognized/compatible-server models)
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers
- Retry with exponential backoff and streaming responses, identical to the Gemini and Ollama providers

## What does not work

Google Search, Google Maps, URL Context (web fetch), Deep Research, image generation, and the vault search index all depend on Gemini cloud services and are unavailable on OpenAI, same as on Ollama. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix.

OpenAI's Chat Completions API also doesn't return model "thinking" the way Gemini does, so no reasoning is shown when talking to `api.openai.com`. A compatible server that emits a `reasoning_content` field on its responses will have that content shown as thoughts.

## Mixed setup: OpenAI chat, Gemini extras

You don't have to choose all-or-nothing. Under **Settings → Gemini Scribe → Per-feature provider**, each feature can be pointed at a different provider — so you can keep chat on OpenAI (or a local compatible server) while still using Gemini's web search or image generation, exactly as you could with an Ollama-primary setup.

To do that:

1. Set **Provider** to **OpenAI (cloud)** as above.
2. Open the **Per-feature provider** section and set the features you want in Gemini's cloud — for example **Web and search** and **Image generation** — to **Google Gemini**.
3. Enter your Gemini **API key** in the field that appears. It's needed by any feature routed to Gemini, even though chat stays on OpenAI.

Nothing moves between providers unless you move it — a feature your default provider can't serve stays off; the plugin never silently substitutes another provider. See [Provider Capabilities](/reference/provider-capabilities) for the full privacy semantics.

## Tips

- **Vision model detection** — Known OpenAI model ids report vision support from a curated metadata table; models from a compatible server default to no vision since the plugin has no way to know the server's capabilities. If your server serves a vision-capable model and attachments aren't working, this is why.
- **Tool calling** — All current OpenAI models support function calling; on GPT-5.6 models it runs with reasoning disabled (see above). Compatible-server models default to "tool calling assumed" — if a model genuinely doesn't support it, tool calls will fail rather than being pre-filtered.
- **A model you want isn't listed** — On `api.openai.com` only the three validated GPT-5.6 models are offered. To use another OpenAI model, point the base URL at a proxy that serves it; catalogs from non-`api.openai.com` URLs aren't filtered.
- **Placeholder API keys** — Required even when your server doesn't check them; the provider won't initialize with an empty key field.
- **Refreshing the model list** — Click **Refresh OpenAI model list** in Settings → General after changing the base URL, loading a different model in a local server, or whenever a dropdown looks stale.
