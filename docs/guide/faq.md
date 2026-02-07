# Frequently Asked Questions

Common questions and answers gathered from [GitHub Issues](https://github.com/allenhutchison/obsidian-gemini/issues) and [Discussions](https://github.com/allenhutchison/obsidian-gemini/discussions).

## Setup & API Key

### Where do I get an API key?

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey). Paste it into the plugin settings under Settings → Gemini Scribe → API Key.

### Why do Pro models fail with my free API key?

Google requires billing to be enabled on your API key to use Pro models (like Gemini 2.5 Pro). Flash models work on free keys. To use Pro models, enable billing in [Google AI Studio](https://aistudio.google.com). ([#76](https://github.com/allenhutchison/obsidian-gemini/discussions/76))

### Can I use my Gemini Pro/Advanced subscription instead of an API key?

No. A consumer Gemini subscription (gemini.google.com) is separate from the API. The plugin only supports API keys. Using OAuth or Code Assist licenses for third-party plugins violates Google's Terms of Service. For cost efficiency, Flash models are recommended — they are excellent for most use cases and significantly cheaper than Pro. ([#304](https://github.com/allenhutchison/obsidian-gemini/discussions/304))

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

## Miscellaneous

### What happened to the "Context Depth" setting?

The depth traversal setting was removed in v4.0 when Agent Mode became the default. The agent now automatically searches your vault for relevant documents using tools instead of following a fixed link-depth hierarchy. Use @ mentions to explicitly add context files. ([#267](https://github.com/allenhutchison/obsidian-gemini/issues/267))

### My custom prompt template isn't being applied

If the agent is ignoring your custom prompt, check that your model's rate limits haven't been exceeded — rate limit errors can appear as generic "failed" messages. Also verify: (1) the prompt file exists in `[Plugin State Folder]/Prompts/`, (2) the frontmatter reference uses correct wikilink syntax `[[Prompt Name]]`, and (3) "Enable Custom Prompts" is toggled on in settings. ([#330](https://github.com/allenhutchison/obsidian-gemini/discussions/330))

---

Still have questions? Check the [GitHub Discussions](https://github.com/allenhutchison/obsidian-gemini/discussions) or [open an issue](https://github.com/allenhutchison/obsidian-gemini/issues).
