# Re-test: Ollama Cloud chat after #1786 (fixes #1785)

- **Date:** 2026-11-22
- **Build:** master `0d16af2e`, installed into Test Vault on Obsidian desktop
- **Setup:** a remote Ollama daemon over Tailscale stood in for `localhost:11434`, since none is installed on the test machine. A dead `127.0.0.1:11434` simulated "daemon down".

**Result: #1785 is fixed.** Cloud chat, cloud tool calls and the cloud-only endpoint all work. No `Failed to fetch` and no `Streaming failed after 4 attempts` appeared. The two caveats below are pre-existing and don't block 4.14.0.

| Step                                             | Result | Evidence                                                                                                                                                |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Combined model list (local endpoint plus key) | ✅     | 2 `(local)` + 25 `(cloud)`; card "2 pulled · 25 cloud"                                                                                                  |
| 2. Local model streams                           | ✅     | `qwen3.6:27b`, `application/x-ndjson`, reply grew as it streamed                                                                                        |
| 3. Cloud chat (`gpt-oss:20b`)                    | ✅     | Replied in one piece after about 3s; console clean                                                                                                      |
| 4. Cloud tool call                               | ✅     | `read_file` ran twice, then a one-line summary of "Pizza in San Jose"                                                                                   |
| 5. Stop on cloud                                 | ⚠️     | Stop took 2 ms and the aborted reply never appeared later. A new message sent within milliseconds of Stop can't be stopped, on local models too (#1790) |
| 6. Cloud-only `https://ollama.com`               | ✅     | 25 models listed, chat replied                                                                                                                          |
| 7. No key on `https://ollama.com`                | ⚠️     | Card shows "Not set up" and the request is never sent, but the notice shows the generic "Invalid API key…" text (#1791)                                 |
| 8. Local daemon down, key set                    | ✅     | "0 pulled · 25 cloud", cloud chat works; only the expected "one model source failed" warning                                                            |

## Follow-ups filed

- **#1790:** if you press Stop and send a new message straight away, the stopped turn's late `finally` resets the new turn's Stop button (shared `isExecuting` check, `agent-view-send.ts:375`). Every Stop also shows a stray "empty response" notice. Neither is new in #1786.
- **#1791:** `getErrorMessage` replaces the "Ollama Cloud needs an API key" guard message with the generic invalid-key text (`error-utils.ts:324`). This came with #1764's guard.

Settings, scheduled-task state and test sessions were restored or removed afterwards.
