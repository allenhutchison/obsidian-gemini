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
3. **Raise Ollama's context window** — Do this before anything else; the default is too small for agent mode. See [Set the context window first](#set-the-context-window-first).
4. **Add the Ollama card** — Open Settings → Gemini Scribe → **Providers** and add an entry for Ollama. If the daemon runs on a different host or port, edit the **Endpoint** field (e.g. `http://10.0.0.5:11434`) instead of the default `http://localhost:11434`.
5. **Route features to it** — Open the **Features** page and set Chat and agent (and anything else you want local) to **Ollama**. Set **Default provider** on the Providers page to Ollama too if you want it to catch everything you haven't routed elsewhere.
6. **Pick a model** — Opening the Chat row's model picker lists whatever you have pulled. Summaries and completions default to **Same as chat model**, because Ollama keeps only one model resident at a time and a second model is reloaded on every switch. Click **Refresh** on the Ollama provider card if a new pull doesn't show up.

## Set the context window first

**This is the single most common cause of bad results with Ollama.** Set the window as large as your hardware allows — at minimum 64k, and 256k if you can.

Ollama does not use the model's full context by default. It picks a window from your available VRAM:

| Available VRAM | Ollama's default window |
| -------------- | ----------------------- |
| Under 24 GiB   | **4,000 tokens**        |
| 24–48 GiB      | 32,000 tokens           |
| 48 GiB and up  | 256,000 tokens          |

Most machines land in that first row. 4,000 tokens is not enough to hold the agent's system prompt and tool definitions plus your note content, so the prompt gets truncated before the model ever sees your question. The model then answers from whatever fragment survived — which looks like the agent ignoring your vault and inventing files that don't exist ([#1252](https://github.com/allenhutchison/obsidian-gemini/issues/1252)). Nothing in the plugin's settings can compensate; the window has to be raised in Ollama itself.

Note this is independent of the model: pulling a model that advertises a 262k context still gets you a 4k window if that's what your VRAM tier allows.

**Desktop app** — Open Ollama's settings and drag the context length slider up.

**Running `ollama serve` yourself** — Set the environment variable:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

To make it permanent on macOS or Linux, export it from your shell profile; on Windows, add it under System Properties → Environment Variables and restart Ollama.

**Verify it took effect** — Send one message to the model, then check what the daemon actually allocated:

```bash
curl -s http://localhost:11434/api/ps
```

The `context_length` in the response is your real window. Gemini Scribe reads the same value, so the token counter under the agent input shows the true window and compacts against it — if the counter says 4,000, Ollama is still on its default.

The tradeoff is memory: a larger window costs more RAM/VRAM and slows generation. If Ollama fails to load a model after raising it, step the value down.

## Cloud models

Ollama can also run large models on its own servers — `gpt-oss:120b-cloud`, `deepseek-v4-pro:cloud`, and similar. These reach the plugin like local models (same daemon, same API, same auto-detected capabilities), but the inference happens on ollama.com.

Tool calling and vision still depend on the model you pick, exactly as they do locally — being cloud-hosted grants neither. Most current cloud models report tool support, but vision is common to skip: of the models available here, `kimi-k2.7-code:cloud` and `qwen3.5:397b-cloud` report vision while the larger `deepseek-v4-pro:cloud` and `glm-5.2:cloud` do not, so image attachments fail on the latter. The picker reflects whatever `/api/show` reports for each model.

**You must pull a cloud model before the plugin can see it.** This is the part that trips people up: running a cloud model from the Ollama desktop app or via `ollama run` does _not_ register it locally. The plugin builds its model list from the daemon's `/api/tags` endpoint, which only reports models that have a local manifest — so a cloud model you've been happily using elsewhere will still be missing from the picker.

To make one selectable:

1. Sign in once with `ollama signin`.
2. Pull the model. This downloads only a small manifest, not the weights:
   ```bash
   ollama pull deepseek-v4-pro:cloud
   ```
3. Click **Refresh** on the Ollama provider card in Settings → Gemini Scribe → Providers.

Mind the tag format — it differs depending on whether the model has a size tag:

| Model                  | Cloud name                   | Rule                                |
| ---------------------- | ---------------------------- | ----------------------------------- |
| `gpt-oss:120b`         | `gpt-oss:120b-cloud`         | tagged → append `-cloud` to the tag |
| `mistral-large-3:675b` | `mistral-large-3:675b-cloud` | tagged → append `-cloud` to the tag |
| `deepseek-v4-pro`      | `deepseek-v4-pro:cloud`      | untagged → `cloud` _is_ the tag     |
| `glm-5.2`              | `glm-5.2:cloud`              | untagged → `cloud` _is_ the tag     |

Guessing wrong gives `model 'name-cloud:latest' not found`. Run `ollama list` after pulling to confirm the exact name the plugin will show.

Two caveats:

- **A cloud model sends your notes to ollama.com.** Selecting one means requests for that feature leave your machine even though the provider is "Ollama" — the Ollama card's "Connected" status doesn't distinguish local from cloud-hosted models, so check what you pulled. If you switched to Ollama for privacy, stay on locally pulled models.
- **Pulling doesn't guarantee access.** Some models are excluded from included plan usage. A pull always succeeds, but the first request fails with `this model uses extra usage only ... your extra usage balance is empty`. Check your plan at [ollama.com/settings](https://ollama.com/settings), or `ollama rm` the model so it stops appearing in the picker.

### Ollama Cloud without a local install

You can also skip the local daemon and point the plugin straight at Ollama's hosted API. This works on machines with no Ollama installed, including mobile.

1. Create an API key at [ollama.com/settings/keys](https://ollama.com/settings/keys).
2. In **Settings → Providers → Ollama**, set **Endpoint** to `https://ollama.com`.
3. Under **API key**, pick or create a secret holding that key. It is stored in Obsidian's secret storage, not in your vault.
4. Press **Refresh** on the Models row. The list comes live from `https://ollama.com/api/tags`, so it shows every cloud model your account can use, with no `ollama pull` step.

Every request for an Ollama-routed feature then goes to ollama.com with the key as a bearer token. Without a key, an `https://ollama.com` endpoint shows **Needs key** and the plugin sends it nothing. The key is only sent over HTTPS or to `localhost`; a plain `http://` endpoint on another host gets no key. The same key field also works for a self-hosted Ollama behind an authenticating HTTPS proxy.

**Replies from ollama.com arrive all at once.** ollama.com doesn't accept requests from a browser page, so the plugin sends them through Obsidian's own network layer instead, which only hands back a reply once it is complete. A chat with a model sent straight to ollama.com therefore shows nothing until the model finishes, then the whole answer appears; tool calls work as usual. Pressing **Stop** discards the reply, but ollama.com still finishes generating it. Cloud models you pulled into your own daemon (see [Cloud models](#cloud-models)) go through the daemon and still stream.

### Local and Ollama Cloud models together

If you keep the endpoint pointed at your own Ollama (the default `http://localhost:11434`, or any custom URL) **and** add an API key, the model list is the union of both: your endpoint's models plus every model Ollama Cloud offers your key. Each entry says where it runs, `(local)` or `(cloud)`, and each request goes to the endpoint that serves the model you picked: local models to your endpoint, cloud models to `https://ollama.com` with the key.

- **A name in both places is two entries.** If `gpt-oss:120b` is pulled locally and also offered by Ollama Cloud, you see `gpt-oss:120b (local)` and `gpt-oss:120b (cloud)`, and pick whichever you want. The cloud entry is saved as `cloud::gpt-oss:120b`, which is how the plugin knows to send it to ollama.com.
- **One side being down doesn't hide the other.** If the local daemon isn't running, the cloud models still load (and the local ones reappear within about 30 seconds of it starting, or when you press **Refresh**); if ollama.com is unreachable, your local models still load.
- **The key is also sent to your own endpoint**, as long as it is HTTPS or `localhost`, so an authenticating proxy keeps working. Remove the key to list only your endpoint's models again. Cloud models you pulled into the daemon (see [Cloud models](#cloud-models)) stay listed as `(cloud)` either way, and still send your notes to ollama.com.
- **Cloud entries are never picked for you.** A feature whose model is left on the default only ever gets a `(local)` model; you have to choose a `(cloud)` entry yourself.
- **`(cloud)` replies arrive all at once**, not word by word, for the reason in [Ollama Cloud without a local install](#ollama-cloud-without-a-local-install). `(local)` replies still stream.
- **A `(cloud)` model sends your notes to ollama.com**, the same as a pulled cloud model. Stick to `(local)` entries if you want nothing to leave your machine.

## What works

- Agent chat with streaming, tool calling, and conversation memory (replies from models sent straight to ollama.com arrive in one piece rather than streamed)
- Drag-and-drop / paste of **image** attachments to vision models (e.g. `llava`, `moondream`, `qwen2.5-vl`); vision support is auto-detected from the model's reported capabilities via `/api/show`
- File summarization, IDE-style completions, selection rewriting
- Custom prompts, projects, agent skills, scheduled tasks, MCP servers

## What does not work locally

Google Search, Google Maps, URL Context (web fetch), Deep Research, image generation, and the vault search index all depend on Gemini cloud services. With every feature routed to Ollama they are off, and — as long as your selected models are pulled locally — nothing leaves your machine. See the [Provider Capabilities reference](/reference/provider-capabilities) for the full matrix and the reasons behind each gap.

Switching a feature back to Gemini at any time turns it on again — settings persist across changes.

## Mixed setup: local chat, cloud extras

You don't have to choose all-or-nothing. On the **Features page**, each feature can be pointed at a different provider — so you can keep chat local while still using Gemini's web search or image generation.

To do that:

1. Add the Ollama card and route Chat and agent to it, as above.
2. Add the Gemini card too (Settings → Gemini Scribe → **Providers**), with your Gemini **API key**. It's needed by any feature routed to Gemini, even though chat stays local.
3. Open the **Features** page and set the features you want in the cloud — for example **Web search** and **Image generation** — to **Gemini**.

Two things to keep in mind:

- **Nothing moves to the cloud unless you move it.** A feature routed to a provider that can't serve it, or isn't connected, stays off; the plugin never silently substitutes another provider.
- **A feature you route to Gemini sends its data to Google** — including note content, for tools that read your notes. The Providers page's privacy note names exactly which features are affected whenever any are. The **Vault search index** is the broadest of these: it uploads note content to a cloud search index rather than just the text of one request.

## Tips

- **Vision model detection** — Vision capability is auto-detected from each model's `/api/show` response. Any model that Ollama reports as vision-capable is enabled for image attachments automatically; you do not need to add new keywords or update settings when pulling a new multimodal model.
- **Tool calling** — Most modern instruct models support function calling; older or very small models may not. If the agent loop stalls, try a different model (Llama 3.2, Qwen 2.5, Mistral 0.3 are good starting points).
- **Context window** — The plugin reads the window the daemon actually allocated (`/api/ps`), falling back to the model's advertised maximum (`/api/show`) before its first load and to a conservative 32k only when the daemon can't be reached. Compaction triggers at the percentage set by `Context Compaction Threshold` (default `20`%) of that window, so raising Ollama's context length directly buys you longer sessions before summarization kicks in. See [Set the context window first](#set-the-context-window-first).
- **Token counts** — Ollama does not expose a `countTokens` endpoint, so the plugin estimates tokens from character length, starting at a chars ÷ 4 default and calibrating a per-model ratio from each response's real token counts as the session progresses. The token-usage indicator is approximate early in a session and becomes more accurate after the first few turns with a given model.
- **Daemon down?** — If the daemon stops, agent calls will surface a "Could not connect to the Ollama daemon" notice. Restart with `ollama serve` and click **Refresh** on the Ollama provider card.
