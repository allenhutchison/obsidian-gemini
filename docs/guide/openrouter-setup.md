# OpenRouter

Gemini Scribe can route chat, summary, completions, rewrite, agent tool-calling, and image generation through **[OpenRouter](https://openrouter.ai)**, a gateway that serves models from many companies (Anthropic, Google, OpenAI, Meta, DeepSeek, Mistral, Qwen, and more) behind one API key and one bill. Use it when you want to try many models without signing up with each company, or when the model you want isn't offered by the other providers.

This uses API-key billing: you need an OpenRouter API key and credits (or a free model) on your OpenRouter account.

## Setup

1. **Get an API key** — Visit [openrouter.ai/keys](https://openrouter.ai/keys), create a key, and copy it.
2. **Open the OpenRouter card** — Open Settings → Gemini Scribe → **Providers** and select the **OpenRouter** card.
3. **Enter your API key** — On the API key row, click "Link..." and paste your key. It's stored securely using Obsidian's SecretStorage, the same as the other providers' keys. The card shows **Connected** once a key is set, and the Models row shows how many models OpenRouter offers.
4. **Route features to it** — Open the **Features** page and set Chat and agent (and Summaries, Completions, Rewrite, or Image generation if you want) to **OpenRouter**. Set **Default provider** on the Providers page to OpenRouter too if you want it to catch everything you haven't routed elsewhere.
5. **Pick models** — Each routed feature has its own searchable model picker on the Features page. Type part of a name (for example "claude" or "deepseek") to filter the catalog. Leave a row on **Default** to use the model the plugin picks for you (see below).

## Models

- **How the list is built** — The plugin reads OpenRouter's public catalog, `GET https://openrouter.ai/api/v1/models`, for text models and `GET https://openrouter.ai/api/v1/images/models` for image models. Each model shows its OpenRouter display name (for example "Anthropic: Claude Sonnet 5"), and its context window and image-input support come straight from the catalog, so context compaction and attachments follow the model you pick.
- **Defaults** — OpenRouter's catalog changes constantly, so the defaults are chosen from the live list rather than pinned. Chat uses the newest Gemini Flash model that supports tool calling (if none does, the newest tool-capable Gemini Pro, and failing that the first model in the catalog). Summaries and Rewrite use the newest Gemini Flash, Completions the newest Gemini Flash Lite (or Flash if there is none), and Image generation the newest image model. Pick any other model to override a default.
- **No key yet** — Without a key the card reads **Not set up** and no request is made to OpenRouter, not even for the model list.
- **Refresh** — Click **Refresh** on the OpenRouter card to pick up newly listed models.

## How requests are made

- **OpenAI-compatible API** — Requests go to `https://openrouter.ai/api/v1/chat/completions` in the same Chat Completions format the OpenAI provider uses, with streaming, tool calling, and image attachments.
- **Reasoning** — For models that reason (Claude, Gemini, DeepSeek R1, and others), OpenRouter's reasoning text appears as thoughts in the agent view. During tool calling, the model's structured reasoning (`reasoning_details`) is sent back with each tool round, as OpenRouter requires, so the model keeps its train of thought through a long tool chain.
- **Image generation** — Uses OpenRouter's Images API (`POST https://openrouter.ai/api/v1/images`). The image is saved in whatever format the model returns (PNG, JPEG, or WebP).
- **App attribution** — Each request carries OpenRouter's optional attribution headers (`HTTP-Referer` set to the plugin's GitHub page, and `X-OpenRouter-Title: Gemini Scribe`), so your OpenRouter activity page shows the requests as coming from Gemini Scribe. They carry no vault content.
- **Streaming and retries** — Responses stream live, Stop cancels immediately, and failed requests retry with the same fixed exponential-backoff policy as the other providers.

## What works

- Agent chat with streaming, tool calling (on models that support tools), reasoning display, and conversation memory
- Drag-and-drop or paste of **image** attachments on vision-capable models
- File summarization, IDE-style completions, selection rewriting
- Image generation with the models OpenRouter serves through its Images API
- Custom prompts, projects, agent skills, scheduled tasks, lifecycle hooks, and MCP servers

## What does not work

- **Gemini-only features** — Google Search, URL Context (web fetch), Deep Research, and the vault search index call Google's own APIs. They aren't available on OpenRouter, even for Gemini models; route them to the Gemini provider on the Features page instead. **Google Maps** isn't a routed feature: its tool is offered whenever a Gemini API key is set on the Gemini card, even while chat runs on OpenRouter, and a Maps lookup the agent makes goes to Google. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix.
- **PDF, audio, and video attachments** — Only images are sent. Route chat to Gemini (or Anthropic, for PDFs) for those.
- **Tool calling on every model** — Some models on OpenRouter don't support tools. The agent can't use vault tools with them; pick a model whose OpenRouter page lists "tools" support.
- **Custom base URL** — Not supported. Requests always go to `openrouter.ai`.

## Mixed setup: OpenRouter chat, Gemini extras

On the **Features page**, each feature can use a different provider. For example, you can run chat on a model from OpenRouter while Gemini handles web search:

1. Add your key to the OpenRouter card and route Chat and agent to OpenRouter, as above.
2. Add your Gemini **API key** on the Gemini card. Any feature routed to Gemini needs it, even while chat stays on OpenRouter.
3. On the **Features** page, set **Web search** (and any other Google-backed feature you want) to **Gemini**.

Nothing moves between providers unless you move it (Google Maps, above, follows the Gemini key rather than a route). A feature routed to a provider that can't serve it, or that isn't connected, stays off; the plugin never swaps in another provider.

## Privacy

Features routed to OpenRouter send their requests, including any note content they include, to `openrouter.ai`. OpenRouter then forwards each request to the company that serves the chosen model, so that company's data policy applies too. You can limit which companies OpenRouter may use, and whether they may train on your data, in your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy). See [Provider Capabilities](/reference/provider-capabilities#privacy-semantics) for the full privacy semantics.

## Troubleshooting

- **"No OpenRouter API key configured"** — Chat is routed to OpenRouter but the OpenRouter card has no key. Add one on the card (Setup step 3).
- **"Invalid OpenRouter API key"** — OpenRouter rejected the key (HTTP 401). Check the key on the OpenRouter card, or create a new one at [openrouter.ai/keys](https://openrouter.ai/keys).
- **HTTP 402 / insufficient credits** — Your OpenRouter account is out of credits for a paid model. Add credits on OpenRouter, or pick a free model (ids ending in `:free`).
- **The agent describes changes but doesn't make them** — The chosen model probably doesn't support tool calling. Switch Chat and agent to a model that lists tool support.
- **"OpenRouter only supports image attachments"** — PDF, audio, and video need Gemini (or Anthropic for PDFs); route chat there for those conversations.
