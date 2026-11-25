# Retest: 4.15 follow-up fixes (#1827, #1828, #1829)

Date: 2026-11-25. Combined branch `followups-4.15` = origin/master + `claude/project-thread-jzslhn-1823` @ d8c673d (PR #1827) + `-1824` @ 1a738b7 (PR #1828) + `-1825` @ d8f85fe (PR #1829), merged cleanly. `npm ci && npm run build`, installed into Test Vault.
Debug mode and Show token usage on. Tool policy Cautious, "Stop the agent when a tool fails" on.
Chat on Gemini (`gemini-flash-latest`) for A, B1–B4 and C; on Ollama `cloud::glm-5.3-flash` for B5–B6. Semantic Search on Gemini.

## Result: ALL PASS

B5 passes in intent (see its row). The only console errors were 7 "Upload failed" lines per rescan for empty notes; these predate the three PRs and are filed as #1831.

## A. Stop on an Allow card (#1828, fixes #1824)

| Step                         | Result   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 Stop on the card          | **PASS** | "Use google_search to find the current population of Lisbon." → pressed the agent's Stop button while the Allow/Cancel card was showing. The card showed "Permission denied: Google Search was canceled" with no buttons left. The only notice was "Agent execution canceled"; no "The agent stopped because a tool call failed" message. No console errors.                                                        |
| A2 Cancel on the card        | **PASS** | Same prompt, Cancel on the card → the turn ended with "The agent stopped because a tool call failed (google_search)…" (the old behavior).                                                                                                                                                                                                                                                                           |
| A3 Normal message after Stop | **PASS** | The first try, "Reply with just: hi", ran, but the model chose to retry the search (the earlier search request was still unanswered in the history). The Allow card came back and the test script cancelled it, so that turn ended as in A2. That's model behavior, not a stuck view. Repeated A1 in a fresh session, then "Forget the search. Do not call any tools. Reply with just: hi" → replied "hi" normally. |

## B. Hook usage stays out of the chat's token counter (#1827, fixes #1823)

Hook: Agent turn ended → Agent task, Edit mode, prompt from the checklist (append to `Logs/agent-turns.md`, then list the vault root). Each run made around 10 model calls, appended `2026-11-25 - complete` and listed the vault root.

| Step                             | Result             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2–B3 Footer during the hook run | **PASS**           | After "Reply with just: hi", footer **N = 12,065**. The footer was sampled every 0.5s for 75s through the hook run and never changed. Some of the hook's `[ContextManager] Updated usage metadata` lines went above N (12,298 up to 13,662), but `plugin.contextManager.lastUsageMetadata.promptTokenCount` was still 12,065 afterwards. Had those lines reached the chat's counter they would have replaced it, so they came from the hook's own manager.                                      |
| B4 Next message                  | **PASS**           | "Reply with just: ok" → 12,065 → **12,111** (+46, the chat's own growth). It held at 12,111 through the second hook run.                                                                                                                                                                                                                                                                                                                                                                        |
| B5 Ollama (optional)             | **PASS in intent** | Footer 11,682, unchanged through the hook run. A `Calibrated estimated chars/token for cloud::glm-5.3-flash: 4.00 -> 2.09` line did appear during the run, but it starts from the default 4.00 rather than the chat's calibrated 2.00, so it's the hook's own manager. The chat's `estimatedCharsPerToken` for glm was 2.00009 before and after. The checklist's wording ("no Calibrated line during the hook run") would count this as a fail; it should be "the chat's ratio doesn't change". |
| B6 Scheduled task Run now        | **PASS**           | Read-only task (list the vault root and summarize), Run now → ran on glm (2 calls, plus a calibration line from its own manager). The footer stayed at 11,682, and the chat manager's usage and ratio didn't change.                                                                                                                                                                                                                                                                            |
| B7 Cleanup                       | done               | Hook and task deleted, hooks off, `Logs/`, `Hooks/` and the task's run output trashed.                                                                                                                                                                                                                                                                                                                                                                                                          |

## C. One "Rescan complete" notice when sync overlaps a rescan (#1829, fixes #1825)

Rescan started from the Activity modal's RAG tab ("Rescan vault"). The RAG status now lives in the shared background status bar, so clicking it opens the Activity modal. Notices were counted with a MutationObserver plus the peak `.notice` count.

| Step                              | Result   | Evidence                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 Three edits, rescan 1.4s later | **PASS** | Edited `01-Journal/2024-12-30.md`, `01-Journal/2025-02-02.md`, `New File.md`. The modal header showed "Indexing vault" from 1.6s until the scan ended at 111.6s, then "Indexing complete". Exactly **one** notice, "Rescan complete: 3 re-indexed, 49 unchanged". At most one `.notice` element was on screen at any time. |
| C2 Edited notes sync afterwards   | **PASS** | The status went back to indexing at 112.2s (bar at 88%), then idle at 119.9s. All three notes have a newer `lastIndexed`.                                                                                                                                                                                                  |
| C3 Clean rescan                   | **PASS** | No edits → one notice, "Rescan complete: 0 re-indexed, 52 unchanged".                                                                                                                                                                                                                                                      |

### Observations (not failures)

- **Each edited note was uploaded twice:** once by the scan, then again by the queued sync right after it. The PR intends this (the queue keeps changes while a scan runs). It's redundant but harmless.
- **No progress at the start:** the modal showed no progress for the first ~90–105s of each rescan, while the scan checks which files changed. This is the known #1826.
- **Empty notes log errors (#1831):** each rescan logged 7 `[ERROR] Upload failed: Failed to read file: <path>` lines. All 7 files are 0-byte notes. The plugin's adapter returns `null` for empty text on purpose, and gemini-utils' `FileUploader` throws on that `null`. The notes aren't counted as failed (`failedCount: 0`). The three PRs don't touch either side.
- **Stale index entries:** the index cache holds 11 entries for files that no longer exist (left over from earlier test cleanups that reloaded the plugin before the delete sync ran). Hence 63 indexed but 52 scanned. These weren't purged.

## Console errors

- A and B: none.
- C: only the #1831 lines above.

Cleanup: test edits reverted (and their index entries re-synced), test sessions trashed, `data.json` restored (hooks off), debugger detached. The combined build was left installed in the test vault.
