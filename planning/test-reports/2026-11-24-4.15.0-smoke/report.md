# 4.15.0 smoke report (Mac mini, Test Vault at ~/Documents/Test Vault)

Build: smoke-4.15.0 @ 20dbdf2. Keys: Gemini, OpenAI, Anthropic, Ollama (remote host, qwen3.6:27b/qwen3.8:27b + cloud), OpenRouter.
Original routing: chat=ollama/cloud::glm-5.3-flash, summary/completions/rewrite/imageGen=openrouter, webSearch/deepResearch/rag=gemini. Backup: data.json.bak

Note: Obsidian 1.15.1 opens Settings and the hook modal in a pop-out window; driven via app.setting.win.document. Dropdowns changed by setting the real <select> value + change event (Obsidian renders a hidden sizing twin select).

## VERDICT: BLOCKED. One release-blocking failure (2.3). Part 1 and part 10 pass.

> **Update 2026-11-25:** PR #1816 fixes 2.3, 2.4 and 4.3. A retest of those steps (plus Ollama and regression checks) passed on 8e847d3. See [retest-1816.md](retest-1816.md). Once #1816 merges, 2.3 no longer blocks the release.
>
> **Update 2026-11-25:** PR #1820 (agent-turn hook tool-failure outcome, `{fileName}` refused in turn output paths) retested on fe4becf: all steps pass, including the part 1 hook editor checks. See [retest-1820.md](retest-1820.md).

| Part                                           | Result                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1 Agent-turn-ended hook (#1812)                | PASS (1.11 NOT RUN: Obsidian Git not installed)                                                                                |
| 2 Per-session provider picker (#1796)          | **FAIL 2.3 (blocking)**. 2.1, 2.2, 2.4–2.7 PASS. 2.4 logs countTokens 404 errors                                               |
| 3 Stop and send again (#1792)                  | PASS                                                                                                                           |
| 4 GPT-6.2 / Images 2.6 (#1805)                 | PASS except 4.3 PARTIAL (a session pinned to OpenAI shows a 1,000,000 limit, not 922,000)                                      |
| 5 Token count after compaction (#1794)         | 5.1 PASS. 5.2 and 5.3 FAIL (non-blocking)                                                                                      |
| 6 Attachment notices (#1808)                   | PASS                                                                                                                           |
| 7 Keyboard activation (#1810)                  | PASS                                                                                                                           |
| 8 Indexing progress / maps gate (#1793, #1795) | 8.1 FAIL (non-blocking, likely pre-existing). 8.2 PASS                                                                         |
| 9 Refactor regressions (#1798, #1809, #1811)   | PASS (MCP NOT RUN: no servers configured; 9.3 scheduled-task variant only, hooks off; openrouter claude-haiku-5.5 quirk noted) |
| 10 Gemini transport gate                       | PASS: every [smoke] line 200, chat on text/event-stream, dev:errors clean                                                      |

**Blocker 2.3:** pin a session to a provider not routed to any feature (Anthropic/OpenAI here) and leave Model on "Use default". Send is then refused with "No chat model is selected".
Cause: ModelManager.collectActiveModels only loads models for activeProviders(settings), so the pinned provider's role default resolves to ''.
The same union-list miss causes the 2.4 countTokens 404s (a Claude id sent to Gemini countTokens) and the 4.3 wrong context window.
Suggested fix: include providers pinned by open sessions in activeProviders, or resolve the pinned provider's default via its models service.

**Keys available:** Gemini, OpenAI, Anthropic, Ollama (remote host qwen3.6/3.8 plus an Ollama Cloud key), OpenRouter. All five were connected.

**[Gemini Scribe] console errors seen during the run:**

- ContextManager.countTokens 404 on pinned non-Gemini sessions (2.4)
- the expected Ollama NonRetryable entries (3.4)
- expected GeminiClient retries during the missing-key test (8.2)
  None appeared in part 10.

**Cleanup:**

- settings restored from data.json.bak; the post-smoke copy is in data.json.postsmoke
- 35 test files trashed: smoke-index/, Logs/, the turn-log hook and its state, today's test sessions, the generated image, smoke-sched runs
- RAG index back to 55 files, 0 pending
- the empty Hooks/ folder the test created was removed
- fetch unpatched
- repo on smoke-4.15.0 @ 20dbdf2 with no commits
- nothing tagged, bumped or published

---

## 1. Agent-turn-ended hook

1.1 PASS: toggled "Enable lifecycle hooks" in the settings UI; hooksEnabled=true; Manage/New hook rows appeared; New hook opened the editor.
1.2 PASS: Trigger=Agent turn ended → actions [agent-task, command]; Path glob hidden; prompt desc lists {{turnOutcome}}, {{turnCount}}, {{toolCallCount}}, {{sessionTitle}}, {{userMessage}}.
1.3 PASS: Agent task shows cost warning; Command hides it, shows Command id, Focus file hidden.
1.4 PASS: File modified → Summarize/Rewrite back, Path glob back, Focus file shown for Command. Rewrite → Agent turn ended falls back to agent-task.
1.5 PASS: filled slug turn-log, prompt, maxRunsPerHour 30, clicked Create hook. File gemini-scribe/Hooks/turn-log.md has trigger: 'agent-turn-ended', action: 'agent-task', maxRunsPerHour: 30, prompt body. Edit view round-trips trigger, action, prompt, max runs, debounce 5000, cooldown 30000.
1.6 PASS (on 2nd attempt): first fire (Task 1, 5 s after the turn) completed but wrote nothing, because the hook inherited the global Cautious policy and headless runs only expose pre-approved tools (by design, documented). After setting Tool access → Edit mode in the editor (saved as toolPolicy.preset: edit_mode), "list my files" → one run 9 s after send, Logs/agent-turns.md: "2026-11-24 | complete | 1 tool calls | list my files". Hook's own run did not re-fire it.
NOTE (possible bug, non-blocking): the hook's background turn reported its usage into the chat's ContextManager ("[ContextManager] Skipped lower metadata: prompt=6371 < cached=12258" during Task 1). Hook usage appears to reach the foreground token counter; it was skipped here only because it was lower.
1.7 PASS: Stop pressed 3 s into a long prompt (button label was 'Stop agent execution'); one run (Task 3) appended '| cancelled | 0 tool calls |'.
1.8 PASS: sent "Reply with just: hi" and "Reply with just: ok" 1.6 s apart (second sent as soon as the first finished). Both turns ran; exactly one hook run (Task 4) 5 s after the second; one line logged. turnCount value not directly observable (prompt doesn't render it).
1.9 PASS (outcome) / write failed on model error: session model forced to 'glm-does-not-exist-9' → "model not found" → one hook run (Task 5) whose append_content args carried "2026-11-24 | failed | 0 tool calls | Say hello". The append was rejected because glm added an unknown `summary` param (stopOnToolError ended the run). BackgroundTask still reported "complete" although the hook's only tool call failed (minor).
Stronger evidence for the token-counter note: during Task 5 the chat ContextManager logged "Updated usage metadata: prompt=9705" (the hook's request) and chars/token calibration has drifted to 0.11-0.21 (from 4.0) across hook runs.
1.10 PASS: created a throwaway scheduled task (smoke-sched, once) and ran it (Task 6); no turn-hook run followed. (No file hook was exercised for this step; only the scheduled path.)
1.11 NOT RUN: Obsidian Git not installed in the test vault.
1.12 PASS: hand-edited turn-log.md to action: 'summarize'; after reload: WARN "Hook "turn-log" skipped: action "summarize" can't run for trigger "agent-turn-ended"", 0 hooks loaded, dev:errors clean.
NOTE (pre-existing, not a regression): the hand-edit was NOT picked up live; the old agent-task hook stayed loaded until plugin reload. HookManager has no metadataCache/modify watch on its own Hooks/ files.
Hooks turned off after part 1.

## Part 2 — per-session provider picker (#1796)

Chat routed to gemini (features.chat = gemini/'').
2.1 PASS: Provider dropdown above Model: "Use default (Gemini)", Gemini, Ollama, OpenAI, Anthropic, OpenRouter (all 5 keys connected).
2.2 PASS: Anthropic → Model picker lists only 5 Claude models. Rapid ollama→openai→anthropic (50 ms apart) and openai→ollama both end on the final provider's list only.
2.3 FAIL (blocking per checklist): with Provider = Anthropic and Model left on "Use default", Send is refused with the notice "No chat model is selected. Choose a chat model in settings, or wait for the model list to load." (input not cleared, nothing logged). The Model button reads just "Use default" with no model name (Ollama shows "Use default (glm-5.3-flash (cloud))" because of providerModelMemory).
Root cause: ModelManager.collectActiveModels only loads models for activeProviders(settings) (providers routed to some feature + defaultProvider). Anthropic/OpenAI aren't routed anywhere here, so their models never enter GEMINI_MODELS; resolveFeatureModelFor → getDefaultModelForRole('chat','anthropic') → ''. pinSessionChatModel returns model '' → sendMessage bails at agent.send.noChatModel. The picker itself works because it queries the provider's models service directly. Any user who pins a provider they don't otherwise route to hits this.
Workaround used to continue: pick a model explicitly.
2.3 PASS with explicit model (claude-sonnet-5): 'Which model are you?' and 'list my files' both ran on claude-sonnet-5 (Message Info Model rows; list_files success, follow-up answered). Header badge tooltip: 'Provider: Anthropic / Model: claude-sonnet-5'.
2.4 PASS: frontmatter had provider: anthropic + model: claude-sonnet-5; after `obsidian reload` and reopening the session, modelConfig was {model: claude-sonnet-5, provider: anthropic}; the next turn ran on claude-sonnet-5.
Console ERRORS on reopening: "[Gemini Scribe] ContextManager.countTokens failed with non-retryable error: {name: ApiError, status: 404}" and "[ContextManager] countTokens failed: 404". Same root cause as 2.3: findModelProvider('claude-sonnet-5') misses (Anthropic not in the union list) → providerForContextModel falls back to the chat route (gemini) → Gemini countTokens with a Claude model id → 404. Context-window limit for the pinned model is probably also resolved as Gemini's.
2.5 PASS: Provider → Use default: modelConfig {}, frontmatter has no provider/model keys; next turn ran on gemini-flash-latest.
2.6 PASS: hand-edited 'provider: mistral' into the session frontmatter, reopened it: no error/console error, turn ran on the Chat route (gemini-flash-latest).
2.7 PASS: pinned to anthropic/claude-sonnet-5 (Cautious policy → Allow card), google_search ran via its Gemini route (searchGrounding + citations), cited answer "Source: obsidian.md".
Side note: while pinned to claude-sonnet-5 the footer limit read 1,048,576 before the first real response (Gemini's), then 1,000,000; consistent with the union-list miss above.

## Part 3 — Stop and send again (#1792)

3.1 PASS: 'Write 500 words about tides' stopped at 2.0 s, 'history of lighthouses' sent immediately: button was 'Stop agent execution' from 51 ms after send (first 50 ms while the input is captured) until stopped at ~6 s; no tides text appeared after the second prompt; exactly one 'Agent execution canceled' notice per stop (DOM count), no empty-response notice.
3.2 PASS: Cautious policy, 'Use google_search to find the current population of Lisbon.' → Allow/Cancel card; Stop pressed → card shows 'Permission denied: Google Search was canceled', 0 confirmation buttons left (screenshot stop-card.png).
Minor: the turn then ended with an agent message "The agent stopped because a tool call failed (google_search). Fix the issue and retry, or turn off 'Stop the agent when a tool fails'…" (WARN "User declined tool execution" + stopOnToolError). A user Stop is reported as a tool failure, and the Failed row's Result box is an empty red bar.
3.3 PASS (remote Ollama on a remote host, no localhost Ollama; session pinned ollama/qwen3.6:27b): three real mid-stream Stops at ~3.8–4.3 s with 163–198 chars streamed, button back to Send after each; then 'Reply with just the word: recovered' → 'recovered' in ~1 s. dev:errors clean.
3.4 PASS: ollamaBaseUrl=https://ollama.com, ollamaApiKeySecretName repointed to a nonexistent name → notice "Ollama Cloud needs an API key. Add one on the Ollama card in Settings → Providers." (not "Invalid API key"). Settings restored (remote host URL, secret 'ollama').
The countTokens 404 errors (Gemini countTokens called with a non-Gemini model id) recur on every non-Gemini-pinned session.

## Part 4 — OpenAI GPT-6.2 / Images 2.6 (#1805)

4.1 PASS: OpenAI model list (forced refresh via modelManager.getAvailableModels({forceRefresh:true},'openai')) includes gpt-6.2-sol and gpt-6.2-astra (plus gpt-6-sol/luna/astra, gpt-6.1-sol/terra). The Refresh button itself wasn't clicked.
4.2 PASS: session pinned openai/gpt-6.2-sol, "Read the note 'Pizza in San Jose' and summarize it in two sentences." → read_file ran, correct two-sentence summary in 12.6 s; fetch log shows https://api.openai.com/v1/responses (Responses API path).
4.3 PARTIAL: catalog contextWindow=922000 for every gpt-6/6.1/6.2 id. Chat ROUTED to openai/gpt-6.2-sol → footer "~10,641 / 922,000" PASS. Session only PINNED to gpt-6.2-sol (chat route Gemini) → footer "/ 1,000,000" FAIL. contextWindowForModel() only searches GEMINI_MODELS, the active-provider union; this is the same root cause as 2.3/2.4.
4.4 PASS: imageGen model list = gpt-image-2.6-flare, 2.6-sunburst, 2.5-flare, 2.5-sunburst; 2.5-flare carries defaultForRoles:['image'] (openai-models-service.ts:62). imageGen routed to openai/gpt-image-2.6-flare → generate_image → POST api.openai.com/v1/images/generations → background task complete in 20 s → gemini-scribe/Background-Tasks/generated-A-delicate-watercolor-…-fq4zos.png (PNG 1536×1024, 3.6 MB).
Side note: each new session also calls generativelanguage.googleapis.com/v1beta/interactions (Gemini, presumably session auto-title), even when chat is pinned elsewhere.

## Part 5 — Token count after compaction (#1794)

Setup: there is no 4–8K Ollama model (the remote host's local models are qwen3.6:27b and qwen3.8:27b; the plugin resolves a 114,688 limit). Chat was routed to ollama/qwen3.6:27b and contextCompactionThreshold set to 5% (threshold 5,734). The system prompt plus tools alone are about 12k, so every turn after the first compacts.
A session that is only PINNED to Ollama shows "/ 1,000,000", the same union-list miss as 2.3/4.3, so pinning alone can't drive this test.
5.1 PASS: "Context Compacted" appeared (2 messages over 2 turns).
5.2 FAIL (non-blocking): footer sequence across turns: 14,821 → [compaction "14821 -> 14883"] 14,883 → 14,933 → [compaction] 2,048 → 12,643 (next real report).
The first compaction "reduced" the count upward. The second dropped to 2,048 (history only, no system prompt), then bounced to 12,643 on the next real update.
Cached share never appeared: Ollama reports cached=0, so the over-100% check is NOT TESTABLE here.
5.3 FAIL (non-blocking): a 4-read tool chain compacted mid-loop, and the footer went 12,643 → 4,646 → 15,218 ("Compaction complete: 12774 -> 15218") → 14,052.
Switching sessions and back: before 14,052, after reopening 44,107 (estimate). The count does not match the session.
Likely root cause, for estimate-based providers (no native countTokens): the calibrated chars/token ratio for qwen3.6:27b slid 4.00 → 2.00 → 1.01 → 0.92 → 0.51 → 0.35. Calibration divides the history char length by a promptTokenCount that includes the ~12k system prompt and tool declarations. As history shrinks after compaction the ratio collapses, so every later estimate (post-compaction, session reopen) is inflated.
Note: the 5% threshold sits below the system-prompt floor, which is extreme, but a 4–8K model as suggested in the checklist hits the same floor.

## Part 6 — Attachment notices (#1808)

Synthetic ClipboardEvent/DragEvent on .gemini-agent-input with File objects (dragging from Finder isn't possible from the CLI).
6.1 PASS: paste .tiff → "Unsupported image format. Please use PNG, JPEG, GIF, or WebP."; paste .heic → same.
6.2 PASS: drop .tiff → same notice.
6.3 PASS: drop png+heic → "Image attached" + "1 image(s) skipped: unsupported format. Use PNG, JPEG, GIF, or WebP."; paste png+tiff+heic → "Image attached" + "2 image(s) skipped: …". Two PNG thumbnails in the attachment strip (attach.png).

## Part 7 — Keyboard activation (#1810)

Real key presses via CDP Input.dispatchKeyEvent (Tab / Shift-Tab / Enter / Space) on the focused element; no mouse.
7.1 PASS: Activity modal: Tab reaches the "RAG" tab, Enter selects it; Shift-Tab back to "Background tasks", Space selects it. Inner RAG tabs (Overview → Files) switch with Space/Enter too.
7.2 PASS (with forced cap): the "Show all N files" control only renders when >200 files are indexed (vault has 55), so I lowered the modal instance's RAG_MAX_FILES_INITIAL to 10 in memory. Enter and Space each expanded 10 → 55, nothing scrolled. Nit: focus falls to <body> after the list re-renders.
7.3 PASS: Tool group summary and tool row headers (role=button, tabindex=0) toggle aria-expanded with both Enter and Space; no scroll, no space typed into the input.
7.4 PASS: Progress status line is not a button (no role/tabindex) and Enter/Space/click are no-ops (defaultPrevented=false) while there is no thinking content; once reasoning streams in it becomes role=button tabindex=0 and Enter/Space expand/collapse the thinking section.

## Part 8 — Indexing progress and maps gate (#1793, #1795)

Semantic Search on Gemini (fileSearch store), vault of 85 files (I added 25 test notes in smoke-index/).
8.1 FAIL (non-blocking; #1793 is a pure refactor, and rag-progress-modal.ts and the upload path are unchanged since 4.14.0, so this is probably pre-existing):

- **No count-up.** Every run sits at "0% (0 / 1) Scanning vault..." for about 90–110 s, then jumps straight to the end ("100% (78/78)").
  The indexVault progress callback (what the Settings button shows) fired only twice: "0/85" → "85/85". The status bar shows "RAG: indexing (…)" or "92% (78/85)", not a running count.
  The modal shows current file and indexed/skipped/failed only at the end.
- **Pause/Resume can't be done mid-run.** The modal has no Pause button. The rag-pause command during a run gives "Cannot pause while indexing is in progress", and rag-resume gives "RAG sync is not paused".
- **Final notice matches the modal on a clean run.** With nothing else syncing, one notice, "Rescan complete: 0 re-indexed, 78 unchanged", matched the modal (78/78).
  **Bug:** when the background sync queue runs at the same time (files edited just before the rescan), the status flips to idle mid-run. RagProgressModal.handleComplete() then fires on every progress event, because it has no once-only guard and the status is not 'indexing'.
  That produced about 80 "Rescan complete" notices with counts climbing from "0 re-indexed, 0 unchanged" to "1 re-indexed, 77 unchanged".
  The same status clobbering showed up through indexVault(): status went idle 17 s into a 95 s run.
- **A second reindex starts from 0:** PASS (each run starts at 0 / 1 and 0 indexed / 0 skipped).
- Settings "Reindex vault" button: settings opens in a popout window and the sub-page navigation didn't respond to synthetic clicks. I drove the same code path, ragIndexing.indexVault(cb), directly: result {indexed:0, skipped:78, failed:0}, callbacks 0/85 → 85/85.
  8.2 PASS: with the Gemini key, the maps prompt ran google_maps (after I approved the confirmation): POST …/models/gemini-3.5-flash:generateContent with googleMaps grounding, then a sensible list (Blue Bottle, Red Bay, Rosalind, Saint Frank…).
  With apiKeySecretName pointed at a nonexistent secret and the plugin reloaded: no key, and google_maps, google_search and deep_research are absent from the tool registry. The agent view, new session and RAG status modal all opened, and dev:errors showed nothing.
  A chat turn showed the notice "Invalid API key. Please check your model provider credentials in settings." No crash.
  Nit: the missing-key request is retried 4 times ("Streaming failed (attempt n/4)…UnexpectedClientError") before that notice appears.
  Key restored (apiKeySecretName=gemini) and the plugin reloaded; google_maps is back.

## Part 9 — Quick regressions for internal refactors (#1798, #1809, #1811)

9.1 PASS. Chat was routed to each provider with an explicit model and a fresh session per run. Prompt: "List my files in the vault root (top level only)…". list_files ran and gave a correct listing on:

- gemini/gemini-3.5-flash (14 s)
- openai/gpt-6.2-sol (9 s)
- anthropic/claude-haiku-4-5 (8 s)
- ollama/qwen3.6:27b on the remote host (27 s)
- openrouter/google/gemini-3.5-flash (12 s) and openrouter/openai/gpt-5-mini (15 s)
  (By accident, all five providers also ran a google_maps call first, and all five completed it.)
  Caveat: openrouter/anthropic/claude-haiku-5.5 failed twice with "Folder not found: """. The schema we send is correct (path: string, "empty string for root"); the model itself streamed arguments {"path": "\"\""}, a literal pair of quote characters.
  That's a model quirk, not the #1809 mapper, but list_files could treat '""' as root.
  No MCP servers are configured, so the MCP tool call was NOT RUN.
  9.2 PASS (Settings → Providers → Ollama, all after plugin reloads):
- Remote local server + key: card "Connected", models "2 pulled · 25 cloud" (Refresh kept the same).
- Local without a key: "Connected", "2 pulled".
- https://ollama.com + key: "Connected", "25 available".
- https://ollama.com without a key: card "Not set up", models "Not set up". No errors.
  Restored afterwards: remote host URL plus the ollama secret, back to "2 pulled · 25 cloud".
  (Before the first check the card said "Not checked yet" until the card opened.)
  9.3 PASS: scheduled task smoke-fail (model gemini-nonexistent-smoke-model) run with runNow ×4.
  consecutiveFailures went 1, 2, 3 → pausedDueToErrors=true at 3, with the warning "Task "smoke-fail" paused after 3 consecutive failures".
  The manager shows "interval:600m · paused" plus the 404 error and a Reset button. A manual "Run now" still forces a run while paused, which I take as intended.
  Hooks are off in this vault, so I didn't test the hook variant. Task deleted afterwards.

## Part 10 — Gemini transport gate (run last) — PASS

Chat, summary and webSearch were routed to gemini (role-default models), the checklist's fetch patch was installed, and the plugin was reloaded first.
10.1 PASS: summarize-active-file on smoke-index/note-20.md wrote summary: "This note documents the fourth pass on harbor lights 20."
10.2 PASS: "In two sentences, what is a Zettelkasten?" streamed a correct 2-sentence answer in 15.6 s.
10.3 PASS: "Use Google search to find today's top Obsidian news and cite a source": 1 tool completed (google_search → generateContent on gemini-flash-latest), then a follow-up streamed with "Source: Obsidian Blog & Release Notes (obsidian.md)".
(I read the answer as innerText, so I didn't check whether the citation links somewhere.)
10.4 PASS: every [smoke] line was 200, with no CORS or "Failed to fetch" errors. dev:errors: "No errors captured"; console level=error was empty. The console was cleared between steps, so the plugin's debug.log was also checked for 14:45–14:47 (all of part 10): 0 ERROR/WARN lines.

[smoke] lines:

```
14:45:20 [smoke] 200 application/json https://generativelanguage.googleapis.com/v1beta/interactions            (summary)
14:45:23 [smoke] 200 text/plain; charset=utf-8 .../upload/v1beta/fileSearchStores/obsidiantestvault-4v0ts3t7x0ai:uploadToFileSearchStore   (RAG sync of the edited note)
14:45:25 [smoke] 200 application/json; charset=UTF-8 .../upload/v1beta/fileSearchStores/obsidiantestvault-4v0ts3t7x0ai:uploadToFileSearchStore
14:45:55 [smoke] 200 text/event-stream https://generativelanguage.googleapis.com/v1beta/interactions          (chat stream)
14:46:05 [smoke] 200 application/json https://generativelanguage.googleapis.com/v1beta/interactions            (likely session title)
14:46:23 [smoke] 200 text/event-stream https://generativelanguage.googleapis.com/v1beta/interactions          (search turn, initial)
14:46:49 [smoke] 200 application/json; charset=UTF-8 https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent  (google_search tool)
14:46:52 [smoke] 200 text/event-stream https://generativelanguage.googleapis.com/v1beta/interactions          (follow-up after tool)
14:47:02 [smoke] 200 application/json https://generativelanguage.googleapis.com/v1beta/interactions            (likely session title)
```
