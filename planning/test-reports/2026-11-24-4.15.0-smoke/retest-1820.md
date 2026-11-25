# Retest: PR #1820 (agent-turn hook: tool-failure outcome, {fileName} in output path)

Date: 2026-11-25. Build: `retest-1820` @ fe4becf (PR #1820 head), installed into Test Vault. Lifecycle hooks enabled for the retest.
Chat routed to Ollama (`cloud::glm-5.3-flash`). Global tool policy Cautious. "Stop the agent when a tool fails" on.
Turn-log hook: Agent turn ended → Agent task, tool policy Edit mode, output path `Hooks/Runs/{slug}/{date}.md`, prompt logging `{{turnOutcome}}` and `{{toolCallCount}}`. The outcome for each step was read from the run file's `turn_outcome` frontmatter and body.

## Result: ALL PASS. No `[Gemini Scribe]` console errors in any step. Step 4 needed a different prompt (see below).

| Step                            | Result                       | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Hook editor still works       | **PASS**                     | Agent turn ended: Action offers only Agent task and Command; no Path glob; cost warning shown for Agent task; Focus file hidden (also with Command). Advanced → Output path help: "Supports {slug} and {date}." Switching to File modified: "Supports {slug}, {date}, {fileName}.", and Path glob, Focus file and all four actions return. No console errors on open. |
| 2 `{fileName}` refused          | **PASS**                     | `Hooks/Runs/{slug}/{fileName}.md` → notice "The output path can't use {fileName} for the agent turn trigger, because a turn has no file. Use {slug} or {date} instead."; no hook file created. `Hooks/Runs/{slug}/{date}.md` → "Hook "turn-log" created".                                                                                                             |
| 3 Hand-written hook skipped     | **PASS**                     | After editing `outputPath` to `{fileName}` and reloading: `[HookManager] Hook "turn-log" skipped: outputPath can't use {fileName} for trigger "agent-turn-ended", which has no file`, then "Initialized with 0 hook(s)".                                                                                                                                              |
| 4 Tool failure reports `failed` | **PASS (substitute prompt)** | "Use the read_file tool to read the path .obsidian/app.json" → `read_file` fails ("Cannot read from system folder"), the turn ends with the "tool call failed" notice, and the run file says `turn_outcome: "failed"` / `TURN OUTCOME = failed (tools=1)`.                                                                                                            |
| 5 Stop still wins               | **PASS**                     | Prompt needing `google_search`; pressed the agent's Stop button while the Allow card was showing → run file `turn_outcome: "cancelled"`.                                                                                                                                                                                                                              |
| 6 Normal turn                   | **PASS**                     | "list my files" → `turn_outcome: "complete"`.                                                                                                                                                                                                                                                                                                                         |

## Step 4: the checklist's prompt can't trigger the stop

"Read the note Does-Not-Exist-123" makes `read_file` return `success: true` with `exists: false`. That is deliberate (`src/tools/vault/read-file-tool.ts`: "File not existing is information, not an error"), so `stopOnToolError` never fires. With that prompt the turn ran 3 tools and logged `complete`, which is correct but doesn't exercise the fix. Use a prompt whose tool returns `success: false`, such as reading a path in `.obsidian/`.

## Observations (not failures)

- Step 5: after Stop, the chat shows "The agent stopped because a tool call failed (google_search)", because the declined call is reported as a failed tool. The hook still records `cancelled`. Not checked against master.
- The output path resolves from the vault root, so runs land in `Hooks/Runs/turn-log/` at the top of the vault, not under `gemini-scribe/`. Same-day runs with `{date}` get new files (`2026-11-25-1.md`, `-2`, …) rather than overwriting.

Cleanup: hook, hook state, run outputs and test sessions trashed; settings restored (hooks off). The #1820 build was left installed in the test vault.
