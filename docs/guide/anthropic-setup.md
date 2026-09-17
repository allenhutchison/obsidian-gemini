# Anthropic (Claude)

Gemini Scribe can route chat, summary, completions, rewrite, and agent tool-calling through **Anthropic's Messages API** to Claude models instead of the Google Gemini API. Use this when you already pay for Claude, or prefer Claude for writing and agent work.

This uses API-key billing: you need an Anthropic API key. A Claude.ai subscription does not include API access.

## Setup

1. **Get an API key** — Visit [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys), create a key, and copy it.
2. **Open the Anthropic card** — Open Settings → Gemini Scribe → **Providers** and select the **Anthropic** card.
3. **Enter your API key** — On the API key row, click "Link..." and paste your key. It's stored securely using Obsidian's SecretStorage, the same as the Gemini and OpenAI keys. The card shows **Connected** once a key is set.
4. **Route features to it** — Open the **Features** page and set Chat and agent (and Summaries, Completions, or Rewrite if you want) to **Anthropic**. Set **Default provider** on the Providers page to Anthropic too if you want it to catch everything you haven't routed elsewhere.
5. **Pick models** — Each routed feature has its own model dropdown on the Features page. Leave it on **Default** — the option names the model it resolves to, e.g. "Default (Claude Opus 5)" — or choose another Claude model. Click **Refresh** on the Anthropic card if the list looks stale.

## Models

The dropdowns list a curated set of Claude models that have been validated against the plugin:

| Model              | Default for      | Context window | Reasoning shown |
| ------------------ | ---------------- | -------------- | :-------------: |
| `claude-opus-5`    | Chat and Rewrite | 1M tokens      |        ✓        |
| `claude-sonnet-5`  | Summaries        | 1M tokens      |        ✓        |
| `claude-haiku-4-5` | Completions      | 200k tokens    |        ✗        |
| `claude-fable-5-1` | —                | 1M tokens      |        ✓        |
| `claude-opus-4-8`  | —                | 1M tokens      |        ✓        |

- **How the list is built** — The plugin asks `GET https://api.anthropic.com/v1/models` which models your key can use, and shows the curated models that appear in the answer. Display names and context windows come from that response.
- **Offline or no key yet** — If no key is set, or the models endpoint can't be reached, the full curated list is shown so you can still set up routing. If your key is invalid, the first real request shows an "Invalid Anthropic API key" notice.
- **Other Claude models** — Models outside the curated list aren't offered, because the plugin shapes each request (thinking, fallbacks) for each model.

## How requests are made

- **Adaptive thinking** — Every offered model except Haiku 4.5 runs with adaptive thinking. Claude decides how much to reason, and a summary of that reasoning appears in the agent view, the same as Gemini's thinking. Haiku 4.5 runs without thinking.
- **Tool calling** — Agent mode works normally. Claude's reasoning is carried across each tool round, so a long tool chain keeps its train of thought.
- **Prompt caching** — Requests use Anthropic's automatic prompt caching. The system prompt and conversation history are reused across agent tool rounds and follow-up turns, which lowers cost and latency. Cached tokens appear in the token usage readout.
- **Refusal fallback (Opus 5 and Fable 5.1)** — These models can decline a request that trips a safety classifier. For them, the plugin turns on Anthropic's server-side refusal fallback (the `server-side-fallback-2026-07-01` beta with `fallbacks: 'default'`). A refused request is re-run on a fallback model within the same call and billed at that model's rates. If the whole chain declines, you'll see a "Claude declined to respond to this request" error.
- **Streaming and retries** — Responses stream live, Stop cancels immediately, and failed requests retry with the same fixed exponential-backoff policy as the other providers.

## What works

- Agent chat with streaming, tool calling, reasoning display, and conversation memory
- Drag-and-drop or paste of **image** and **PDF** attachments, including images and PDFs the agent reads with its file tools
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, lifecycle hooks, and MCP servers

## What does not work

- **Gemini-only features** — Google Search, Google Maps, URL Context (web fetch), Deep Research, image generation, and the vault search index all depend on Gemini cloud services. They aren't available on Anthropic. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix.
- **Audio and video attachments** — Not supported; route chat to Gemini for those.
- **Custom base URL** — Not supported. Requests always go to `api.anthropic.com`.

## Mixed setup: Claude chat, Gemini extras

On the **Features page**, each feature can use a different provider. For example, you can keep chat on Claude while Gemini handles web search or image generation:

1. Add your key to the Anthropic card and route Chat and agent to Anthropic, as above.
2. Add your Gemini **API key** on the Gemini card. Any feature routed to Gemini needs it, even while chat stays on Anthropic.
3. On the **Features** page, set the features you want from Gemini's cloud, such as **Web search** and **Image generation**, to **Gemini**.

Nothing moves between providers unless you move it. A feature routed to a provider that can't serve it, or that isn't connected, stays off; the plugin never swaps in another provider.

## Privacy

Features routed to Anthropic send their requests, including any note content they include, to `api.anthropic.com`. The plugin calls two endpoints there: the Messages API (`/v1/messages`) for requests and the Models API (`/v1/models`) for the model list. See [Provider Capabilities](/reference/provider-capabilities#privacy-semantics) for the full privacy semantics.

## Troubleshooting

- **"No Anthropic API key configured"** — Chat is routed to Anthropic but the Anthropic card has no key. Add one on the card (Setup step 3).
- **"Invalid Anthropic API key"** — The API rejected the key (HTTP 401). Check the key on the Anthropic card, or create a new one at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys).
- **A model is missing from the dropdown** — Your key's organization may not have access to it. Click **Refresh** on the Anthropic card after access changes.
- **"Anthropic only supports image and PDF attachments"** — Audio and video need Gemini; route chat to Gemini for those conversations.
