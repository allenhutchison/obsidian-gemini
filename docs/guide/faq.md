# Frequently Asked Questions

Common questions and answers gathered from [GitHub Issues](https://github.com/allenhutchison/obsidian-gemini/issues) and [Discussions](https://github.com/allenhutchison/obsidian-gemini/discussions).

## Setup & API Key

### Where do I get an API key?

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey). Paste it into the plugin settings under Settings → Gemini Scribe → API Key.

### Why do Pro models fail with my free API key?

Google requires billing to be enabled on your API key to use Pro models (like Gemini 2.5 Pro). Flash models work on free keys. To use Pro models, enable billing in [Google AI Studio](https://aistudio.google.com). ([#76](https://github.com/allenhutchison/obsidian-gemini/discussions/76))

### Can I use my Gemini Pro/Advanced subscription or Gemini CLI login instead of an API key?

No. The plugin requires an API key from [Google AI Studio](https://aistudio.google.com/apikey) — it cannot use a consumer Gemini subscription (gemini.google.com) or the Gemini CLI's OAuth/Code Assist credentials. Even if you have a paid Gemini plan and the CLI works, these are separate systems:

1. **Terms of Service**: Google's ToS prohibit third-party tools from reusing Code Assist OAuth credentials. Google has contacted other integrators who attempted this approach.
2. **Missing features**: The Code Assist endpoint doesn't support server-side tools the plugin relies on, including image generation and the file search API used for semantic vault search.
3. **Cost tip**: Flash models (e.g., Gemini 2.5 Flash) are excellent for nearly all plugin use cases and are significantly cheaper than Pro models. Flash Lite is a great option for summaries and predictive typing.

([#390](https://github.com/allenhutchison/obsidian-gemini/issues/390), [#304](https://github.com/allenhutchison/obsidian-gemini/discussions/304))

### The plugin won't load and I can't access settings to enter my API key

This was fixed in v4.3.1. Update to the latest version — the plugin now loads partially when unconfigured so you can access settings. ([#316](https://github.com/allenhutchison/obsidian-gemini/issues/316))

## Rate Limits & API Errors

### I'm getting "Rate limit exceeded" errors

This is the most common issue. A Gemini Pro _consumer_ subscription does **not** increase API rate limits — those are separate. On a free API key, you will hit low rate limits quickly.

**To fix:**

1. Enable billing on your API key in [Google AI Studio](https://aistudio.google.com)
2. Or switch to a model with more free quota (e.g., Gemini 2.5 Flash instead of 3.0)
3. Check your usage at the [rate limits dashboard](https://ai.google.dev/gemini-api/docs/rate-limits)

([#296](https://github.com/allenhutchison/obsidian-gemini/issues/296))

### I'm getting "Failed to send message" on every query

This is usually caused by an invalid/expired API key or an unavailable model.

**Steps to debug:**

1. Verify your API key is valid in [Google AI Studio](https://aistudio.google.com)
2. Enable **Debug Mode** in plugin settings
3. Open the developer console (Ctrl/Cmd + Shift + I) for detailed error messages
4. Try switching to a different model

([#262](https://github.com/allenhutchison/obsidian-gemini/issues/262), [#268](https://github.com/allenhutchison/obsidian-gemini/issues/268))

### Requests fail after several retry attempts

The plugin has built-in retry logic with exponential backoff (3 attempts by default). If requests keep failing, it's usually a rate limit or transient API issue. Check your API key validity and rate limit dashboard. You can adjust retry settings under Advanced Settings. ([#131](https://github.com/allenhutchison/obsidian-gemini/issues/131))

## Models

### A model I selected shows "model not found"

Google regularly retires preview model versions. Enable **Model Discovery** under Advanced Settings to dynamically fetch available models from the API instead of relying on the built-in static list. ([#223](https://github.com/allenhutchison/obsidian-gemini/issues/223))

### Where are the Temperature and Top-P settings?

These are available under **Advanced Settings** in the plugin settings. Click "Show Advanced Settings" to reveal them. Temperature ranges are automatically adjusted based on the selected model's capabilities. ([#105](https://github.com/allenhutchison/obsidian-gemini/issues/105))

## Cost & Billing

### How much does this plugin cost to use?

Gemini Scribe itself is free and open source. The cost comes from the Gemini API calls it makes on your behalf. Google offers a generous free tier for most models, and Flash/Flash Lite models are very inexpensive even on paid tiers — for typical plugin usage (chat, summaries, completions) most users spend pennies per day or stay on the free tier entirely.

### How can I track my spending?

Google provides authoritative dashboards in AI Studio:

- **[Usage dashboard](https://aistudio.google.com/usage)** — token counts, request counts, and model breakdown
- **[Billing page](https://aistudio.google.com/billing)** — invoices, payment methods, account tier
- **[Spend page](https://aistudio.google.com/spend)** — current and historical spending

The plugin also shows live token usage for the current agent session in the chat UI, so you can see how much context the current conversation is consuming at a glance.

### Can I set a spending cap?

Yes. Google provides two types of spending controls:

1. **Project-level monthly cap (experimental)** — Set a monthly limit for your specific Google Cloud project via [aistudio.google.com/spend](https://aistudio.google.com/spend) → **Monthly spend cap** → **Edit spend cap**. Billing is evaluated with up to ~10 minute delay, so small overages are possible.

2. **Account tier caps** — Each billing account tier has a built-in monthly ceiling (Tier 1: $250, Tier 2: $2,000, Tier 3: $20,000+). Tier caps become enforced on **April 1, 2026**.

The free tier has no cap but is subject to rate limits. Full details: [Gemini API billing docs](https://ai.google.dev/gemini-api/docs/billing).

### How do I keep costs low?

- **Use Flash models** for chat and agent interactions (Gemini 2.5 Flash is excellent and significantly cheaper than Pro)
- **Use Flash Lite** for summaries and inline completions
- **Set a project-level spend cap** in AI Studio for peace of mind
- **Watch the session token counter** in the agent UI to spot runaway conversations
- **Reset long sessions** periodically — agent sessions accumulate context, and longer sessions cost more per turn

## Agent Mode

### What happened to the separate "Classic Chat" and "Agent Mode"?

In v4.0, the plugin was unified into a single agent-first interface. There is now only one chat mode with full agent capabilities. The old classic chat mode was removed. ([#123](https://github.com/allenhutchison/obsidian-gemini/discussions/123))

### How do I use the fetch_url tool?

`fetch_url` is a built-in agent tool — you don't invoke it directly. Simply ask the agent to visit or summarize a URL in your message (e.g., "Summarize the content at https://example.com") and the agent will automatically use the tool. ([#292](https://github.com/allenhutchison/obsidian-gemini/discussions/292))

### The agent is hallucinating file contents instead of reading actual files

Make sure you're on v4.0 or later — earlier versions had a bug where context files were not properly read from the vault. If you still see issues, verify the file is properly tagged with @ and appears as a chip in the chat input. ([#159](https://github.com/allenhutchison/obsidian-gemini/discussions/159), [#180](https://github.com/allenhutchison/obsidian-gemini/issues/180))

### "Summarize Active File" isn't working

This command requires: (1) a markdown file actively open in the editor, and (2) context sending to be enabled. If no file is open, you'll see "Failed to get file content for summary." ([#134](https://github.com/allenhutchison/obsidian-gemini/issues/134))

## Semantic Vault Search (Experimental)

### What does the Vault Index feature do? Is my data private?

The vault index uses Google's File Search API to enable semantic (meaning-based) search of your vault. Files are stored in an index private to your GCP project, tied to your API key. Your data is not shared or used for model training. The feature is experimental and located under Advanced Settings. ([#297](https://github.com/allenhutchison/obsidian-gemini/discussions/297))

## Plugin Conflicts

### RAG indexing creates runaway "Untitled" notes in the plugin state folder

This is caused by a conflict with the **Folder Notes** plugin, not Gemini Scribe itself. Folder Notes automatically creates notes when it detects new folders or file activity, and the rapid file operations during RAG indexing can trigger it repeatedly.

**To fix:** Disable the Folder Notes plugin, or configure it to ignore the Gemini Scribe state folder (default: `gemini-scribe/`). ([#463](https://github.com/allenhutchison/obsidian-gemini/discussions/463))

## Miscellaneous

### What happened to the "Context Depth" setting?

The depth traversal setting was removed in v4.0 when Agent Mode became the default. The agent now automatically searches your vault for relevant documents using tools instead of following a fixed link-depth hierarchy. Use @ mentions to explicitly add context files. ([#267](https://github.com/allenhutchison/obsidian-gemini/issues/267))

### My custom prompt template isn't being applied

If the agent is ignoring your custom prompt, check that your model's rate limits haven't been exceeded — rate limit errors can appear as generic "failed" messages. Also verify: (1) the prompt file exists in `[Plugin State Folder]/Prompts/`, and (2) the frontmatter reference uses correct wikilink syntax `[[Prompt Name]]`. ([#330](https://github.com/allenhutchison/obsidian-gemini/discussions/330))

### How do I reuse prompts in Agent mode?

Custom prompts are applied per-session, not executed as commands. To reuse a prompt:

1. Open the agent panel and start or load a session
2. Click the **gear icon** (session settings) in the session header
3. Select your prompt from the **Prompt Template** dropdown
4. The prompt is now active for that session — all messages will use it

To apply the same prompt to different files, add the files as context (drag them in or use `@` to mention them) while the prompt is active.

If you need a repeatable multi-step procedure rather than a behavioral style, consider creating a [skill](/guide/agent-skills) instead. Skills define step-by-step workflows the agent follows on demand.

Custom prompts and skills both work on mobile (Android and iOS). ([#449](https://github.com/allenhutchison/obsidian-gemini/issues/449))

---

Still have questions? Check the [GitHub Discussions](https://github.com/allenhutchison/obsidian-gemini/discussions) or [open an issue](https://github.com/allenhutchison/obsidian-gemini/issues).
