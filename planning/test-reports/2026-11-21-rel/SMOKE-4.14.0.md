# 4.14.0 release smoke test (2026-11-21)

- **Build under test:** `origin/master` @ `12ba1c7a`, after #1777 (Ollama local + cloud) and #1778 (deep research fix) merged. Clean worktree, installed into Test Vault; manifest still 4.13.0.
- **Vault:** Test Vault. Settings, scheduled-task state, and test notes/sessions restored or trashed afterwards.
- **Logging:** a `window.fetch` wrapper logged each request to `generativelanguage.googleapis.com`, `ollama.com` and `:11434` as `[smoke] <status> <content-type> <url>`. ListModels goes through `requestUrl`, so the logger doesn't see it.

**Result:** the Part 1 release gate (Gemini on the new SDK) passes. Deep research is fixed. One ❌: chat with a direct Ollama Cloud model fails (#1785).

## Part 1 — Gemini on `@google/genai` 3.x (release gate) ✅

Chat, Summaries and Web search were routed to Gemini with the default `-latest` models.

| #   | Step                                                                     | Verdict | Evidence                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gemini card **Refresh**                                                  | ✅      | Connected; "Model list updated: 26 models", including `gemini-flash-latest`, `gemini-pro-latest`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` (`gemini-card-refresh.png`) |
| 2   | Summarize a note                                                         | ✅      | New `summary:` written: "This note compiles a list of highly rated pizza restaurants in San Jose…"                                                                               |
| 3   | Agent chat streams                                                       | ✅      | Two-sentence answer in ~13 s; `200 text/event-stream /v1beta/interactions`                                                                                                       |
| 4   | "Use Google search to find today's top Obsidian news and cite a source." | ✅      | "1 tool completed", then a follow-up answer citing `https://obsidian.md/` (`p1-google-search.png`)                                                                               |
| 5   | All `[smoke]` lines 200, no CORS, clean `dev:errors`                     | ✅      | `dev:errors` "No errors captured"; `dev:console level=error` empty                                                                                                               |

`[smoke]` lines (all 200):

```
chat     200 text/event-stream  /v1beta/interactions
title    200 application/json   /v1beta/interactions
summary  200 application/json   /v1beta/interactions
search   200 text/event-stream  /v1beta/interactions
         200 application/json   /v1beta/models/gemini-flash-latest:generateContent   (google_search tool)
         200 text/event-stream  /v1beta/interactions                                 (follow-up)
RAG      200 application/json   /v1beta/fileSearchStores/obsidiantestvault-…
         200                    /upload/v1beta/fileSearchStores/…:uploadToFileSearchStore
```

Chat and summary now go through the **Interactions API** (`POST /v1beta/interactions`), not `generateContent`; only the `google_search` tool call still uses `generateContent`. This is expected with the new SDK transport.

## Part 2 — Ollama local + cloud (#1777)

Ollama isn't installed on the test machine, so the Ollama server on bubba (`http://bubba…:11434`, over Tailscale) stood in for the local daemon.

| #   | Step                                                      | Verdict        | Evidence                                                                                                                                             |
| --- | --------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Endpoint + key set, **Refresh**                           | ✅             | Card shows "2 pulled · 24 cloud"; the picker labels entries `(local)` and `(cloud)` (cloud values saved as `cloud::<model>`)                         |
| 2   | Local model chat (`qwen3.6:27b`)                          | ✅             | Streamed; `200 application/x-ndjson <endpoint>/api/chat`                                                                                             |
| 3   | Cloud model chat (`cloud::gpt-oss:20b`)                   | ❌             | `FAILED https://ollama.com:443/api/chat TypeError: Failed to fetch` ×4, then "Streaming failed after 4 attempts". CORS: see finding                  |
| 4   | Daemon down → cloud still listed; back up → local returns | ✅ (simulated) | Endpoint pointed at a dead `127.0.0.1:11434`: 0 local / 24 cloud, warning "One model source failed; serving the other". Restored: 2 local / 24 cloud |
| 5   | Key cleared → local only, local chat works                | ✅             | List was just `qwen3.6:27b`, `qwen3.8:27b`; local chat streamed. Key restored                                                                        |

Step 4 was simulated because the remote server couldn't be stopped from the test machine.

### Finding (❌): direct Ollama Cloud chat is blocked by CORS (#1785)

- The chat client (`ollama/browser`) calls `window.fetch` from the renderer.
- ollama.com answers the CORS preflight (`OPTIONS /api/chat`) with **405 and no `Access-Control-*` headers**, so every renderer fetch to it fails. Even an unauthenticated `GET /api/tags` fails, though `curl` gets a 200.
- Model listing works only because it uses `requestUrl`.
- Affected: the cloud entries in #1777's mixed list, and #1765's `https://ollama.com` endpoint (same transport).
- Not affected: cloud models pulled through your own daemon (`ollama pull …-cloud`).
- Suggested fix: pass ollama-js a `requestUrl`-backed `fetch` for the cloud host. Details in #1785.

## Part 3 — Deep research (RAG on, default scope) ✅

- **Fixed by #1778.** The interaction's tools were `[file_search, google_search]`; the 2026-11-21 release run had `file_search` only.
- The job ran 17:34–17:41 (~7 min) and saved a **50 KB** comparative report with 64 unique web citations (grounding-redirect URLs).

## Part 4 — Other providers ✅

| #   | Step                                              | Verdict | Evidence                                                                                                  |
| --- | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| 1   | OpenRouter chat with a tool call                  | ✅      | `anthropic/claude-haiku-5.5`: `read_file` ran (tool callout in session history); correct summary returned |
| 2   | OpenAI `gpt-6.1-sol` reads a note (Responses API) | ✅      | `read_file` ran; correct summary returned                                                                 |

## Console errors

Only the Ollama Cloud ones (`[OllamaClient] Streaming error: Failed to fetch` ×4, `Streaming failed after 4 attempts`, `Failed to send message`). None for Gemini, OpenRouter or OpenAI.

## Verdict

- **The release gate passes.** Gemini on the new SDK is clean.
- **#1785 decides what ships.** Direct Ollama Cloud chat (new in #1765/#1777) doesn't work. Either fix it before tagging, or ship and note in the release notes that direct cloud models list but can't chat yet. Daemon-pulled cloud models are unaffected.
