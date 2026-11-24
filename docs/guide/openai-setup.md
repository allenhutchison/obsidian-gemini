# OpenAI

Gemini Scribe can route chat, summary, completions, rewrite, agent tool-calling, and image generation through OpenAI instead of Google Gemini. Text and agent requests use the **OpenAI Chat Completions API**; image generation uses the dedicated **Images API**. Use this with OpenAI Platform billing, or point the plugin at an **OpenAI-compatible server** — LM Studio, an MLX-served endpoint, Ollama's own OpenAI-compatible endpoint, or similar — running locally or on your network.

This is API-key billing only: there is no "Sign in with ChatGPT" / ChatGPT-subscription (Codex-style) authentication. You need an OpenAI API key, or a placeholder key for a compatible server that doesn't check one.

## Setup

1. **Get an API key** — Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys), create a key, and copy it. If you're only targeting a local compatible server that doesn't validate keys, you can skip this and use any placeholder value instead — the provider still requires a key to be set.
2. **Open the OpenAI card** — Open Settings → Gemini Scribe → **Providers**, then select **OpenAI**.
3. **Enter your API key** — On the **API key** row, click "Link..." and paste your key (or your placeholder value, for a compatible server). It's stored securely using Obsidian's SecretStorage, the same as the Gemini key.
4. **Route features to it** — Open the **Features** page and set Chat and agent (and anything else you want) to **OpenAI**. Set **Default provider** on the Providers page to OpenAI too if you want it to catch everything you haven't routed elsewhere.
5. **Pick models** — Chat, summary, completions, rewrite, and image generation each get their own model picker on the Features page, populated from `GET <OpenAI base URL>/models`. The picker is searchable: click the model button and type part of a model's name to filter the list, which helps on aggregator endpoints that list hundreds of models. (For OpenRouter itself, use the dedicated [OpenRouter provider](/guide/openrouter-setup) instead: it reads OpenRouter's richer catalog, carries reasoning through tool calls, and supports OpenRouter's image models.) Unlike Ollama, OpenAI has no single-resident-model constraint, so picking a different model per feature costs nothing extra. Click **Refresh** on the OpenAI provider card if a model doesn't show up.

If you're using the real OpenAI API, that's it — the base URL defaults to `https://api.openai.com/v1` and you're done.

## Using an OpenAI-compatible server

Point the OpenAI card's **Base URL** field at your server instead of the default, and the plugin talks to it the same way it talks to OpenAI.

Example with [LM Studio](https://lmstudio.ai/):

1. Start LM Studio's local server (Developer tab → Start Server). By default it listens on `http://localhost:1234/v1`.
2. In Gemini Scribe, set the OpenAI card's **Base URL** to `http://localhost:1234/v1`.
3. LM Studio doesn't check API keys, but the plugin still requires the API key field to be non-empty — enter any placeholder value (e.g. `lm-studio`).
4. Click **Refresh** on the OpenAI provider card to pull in whatever model you have loaded in LM Studio.

The same pattern works for MLX-served endpoints, Ollama's OpenAI-compatible endpoint (`http://localhost:11434/v1`), or any other server that implements the `/v1/chat/completions` and `/v1/models` endpoints. Image generation additionally requires a compatible `/v1/images/generations` endpoint that returns `b64_json`; most chat-only local servers do not provide one.

A compatible server's `/models` catalog is taken at face value — the supported-model allowlist described below applies only to `api.openai.com`.

## Models

- **`api.openai.com`** — the endpoint advertises around ninety model ids, most of which this integration can't drive usefully (Responses-API-only, audio, embeddings, older families). The text dropdowns are therefore limited to an allowlist of models checked against the plugin. The three GPT-5.6 models are the feature defaults: **`gpt-5.6-sol`** (chat default), **`gpt-5.6-terra`** (summary default), and **`gpt-5.6-luna`** (completions default). All three accept **922,000 input tokens**, which is what the token counter above the message box reflects. The **GPT-6**, **GPT-6.1** and **GPT-6.2** models (`gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6.2-sol`, `gpt-6.2-astra`) are offered too, but none of them is the declared default for any feature; see [GPT-6 models](#gpt-6-models). Rewrite has no declared default on OpenAI, so if you leave its model unset, the plugin uses the first allowlisted model in the order `/v1/models` returns them, and that can be a GPT-6 model. Pick a rewrite model explicitly if you want a specific one. The GPT-6 models also accept **922,000 input tokens** (OpenAI's model cards list a 1,050,000-token context window with up to 128,000 output tokens), so the token counter uses that limit for them too. The image-generation dropdown offers **`gpt-image-2.5-flare`** (default; fast everyday generation), **`gpt-image-2.5-sunburst`** (higher-precision editing and fidelity), and the Images 2.6 models **`gpt-image-2.6-flare`** and **`gpt-image-2.6-sunburst`**.
- **Where those numbers come from** — OpenAI's `/v1/models` returns no capability metadata (just an id and a creation date), so context windows are curated in the plugin rather than discovered. The GPT-5.6 figure of 922,000 was measured directly against the live API, not taken from documentation. The GPT-6 figure comes from OpenAI's published model cards and hasn't been measured the same way yet.
- **Compatible servers** — an unrecognized model id gets a conservative default: 128k context window, no vision, tool calling assumed. Because `/models` does not report whether a model supports image generation, these models appear in both the text and image-generation dropdowns; the image picker marks their capability as unreported. Selecting one for image generation is an explicit opt-in and succeeds only if the server implements `/v1/images/generations` for that model.

### Reasoning and tool calling on GPT-5.6

The GPT-5.6 models are reasoning models, which constrains what Chat Completions accepts:

- **Sampling settings are ignored.** These models only accept the default temperature and top-p, so the plugin omits both rather than sending a value — moot in practice, since the plugin no longer exposes temperature/top-p settings for any provider.
- **Tool calling runs with reasoning disabled.** `/v1/chat/completions` rejects function tools for these models unless reasoning effort is set to `none`, so any request carrying tools (all agent-mode turns) pins it there. Agent mode works normally; you just won't get reasoning output alongside tool use.

### GPT-6 models

- **`gpt-6-sol` and `gpt-6-luna`** work like GPT-5.6: agent turns use tools on Chat Completions with reasoning set to `none`.
- **`gpt-6.1-*`, `gpt-6.2-*` and `gpt-6-astra`** don't accept tools on Chat Completions, so on `api.openai.com` their agent turns go through OpenAI's **Responses API** (`/v1/responses`) instead. The agent gets its full set of vault tools, with reasoning left on. Requests are sent with `store: false`, so the plugin doesn't rely on response state stored at OpenAI: the whole conversation is sent each time, as with every other provider. This doesn't change OpenAI's own data-retention policy. The model's reasoning is carried across a tool round in encrypted form, and isn't shown in the agent view. Summaries, rewrites and completions still use Chat Completions.
- **Behind a custom base URL** (a proxy serving these models), the plugin can't assume the server implements `/v1/responses`, so agent turns for `gpt-6.1-*`, `gpt-6.2-*` and `gpt-6-astra` go to Chat Completions without tools. The agent can still chat, but it can't read, search or edit your vault.

## What works

- Agent chat with streaming, tool calling, and conversation memory
- Drag-and-drop / paste of **image** attachments to vision-capable models (auto-detected for known OpenAI models; off by default for unrecognized/compatible-server models)
- File summarization, IDE-style completions, selection rewriting
- Image generation from the command palette or `generate_image` agent tool, saved in the same background-task flow used by Gemini
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers
- Retry with exponential backoff (fixed policy, not configurable) and streaming responses, identical to the Gemini and Ollama providers

## What does not work

Google Search, Google Maps, URL Context (web fetch), Deep Research, and the vault search index still depend on Gemini cloud services and are unavailable on OpenAI. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix.

OpenAI image generation is one-shot text-to-image generation through `/v1/images/generations`; image editing and multi-turn image workflows are not exposed in Gemini Scribe. OpenAI may require [API organization verification](https://developers.openai.com/api/docs/guides/image-generation) before GPT Image models can be used.

OpenAI's Chat Completions API also doesn't return model "thinking" the way Gemini does, so no reasoning is shown when talking to `api.openai.com`. A compatible server that emits a `reasoning_content` field on its responses will have that content shown as thoughts.

## Mixed setup: OpenAI chat and images, Gemini extras

You don't have to choose all-or-nothing. On the **Features page**, each feature can be pointed at a different provider — so you can keep chat and image generation on OpenAI while still using Gemini's web search, deep research, or vault index.

To do that:

1. Add the OpenAI card and route Chat and agent to it, as above.
2. Add the Gemini card too (Settings → Gemini Scribe → **Providers**), with your Gemini **API key**. It's needed by any feature routed to Gemini, even though chat stays on OpenAI.
3. Open the **Features** page and route each cloud feature where you want it — for example **Web search** to Gemini and **Image generation** to OpenAI.

Nothing moves between providers unless you move it — a feature routed to a provider that can't serve it, or isn't connected, stays off; the plugin never silently substitutes another provider. See [Provider Capabilities](/reference/provider-capabilities) for the full privacy semantics.

## Tips

- **Vision model detection** — Known OpenAI model ids report vision support from a curated metadata table; models from a compatible server default to no vision since the plugin has no way to know the server's capabilities. If your server serves a vision-capable model and attachments aren't working, this is why.
- **Tool calling** — All offered OpenAI chat models support function calling. On GPT-5.6, `gpt-6-sol` and `gpt-6-luna` it runs with reasoning disabled, and `gpt-6.1-*`, `gpt-6.2-*` and `gpt-6-astra` use the Responses API (see [GPT-6 models](#gpt-6-models)). Dedicated GPT Image models use the Images API instead. Compatible-server text models default to "tool calling assumed" — if a model genuinely doesn't support it, tool calls will fail rather than being pre-filtered.
- **A model you want isn't listed** — On `api.openai.com` only the validated GPT-5.6, GPT-6 and GPT Image models above are offered. To use another model, point the base URL at a proxy that serves it; catalogs from non-`api.openai.com` URLs aren't filtered. Unrecognized compatible-server models remain available for text and are also offered as explicit image-generation opt-ins because `/v1/models` does not report image-generation capability.
- **Placeholder API keys** — Required even when your server doesn't check them; the provider won't initialize with an empty key field.
- **Refreshing the model list** — Click **Refresh** on the OpenAI provider card after changing the base URL, loading a different model in a local server, or whenever a dropdown looks stale.
