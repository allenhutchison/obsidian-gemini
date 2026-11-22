# Pre-release acceptance test — 2026-11-21

- **Build under test:** `origin/master` @ `c8627f32` (clean worktree, installed into Test Vault; manifest 4.13.0 + unreleased changes)
- **Vault:** Test Vault (vault guard passed at every pass boundary)
- **Out of scope:** Ollama local/remote model UX (#1765/#1767 follow-up is being reworked by another agent)
- **Follow-up:** a 4.14.0 smoke test on master `12ba1c7a`, after #1777 and #1778, is in [`SMOKE-4.14.0.md`](SMOKE-4.14.0.md). It covers Ollama local + cloud and re-runs deep research.

## Phase 0 — Scope (changes since 4.13.0)

| PR                                | Change                                                         | Covered by                                   |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| #1736                             | OpenRouter provider                                            | P2 settings/providers/features; P3 (pending) |
| #1754                             | Gemini runtime model discovery                                 | P2 "Refresh model list"                      |
| #1762, #1763                      | GPT-6 / 6.1 models + Responses API routing                     | P2 model picker; P3 (pending)                |
| #1761                             | Provider card shows Connected only when key resolves           | P2 negative test                             |
| #1765, #1767                      | Ollama Cloud                                                   | **excluded**                                 |
| #1760, #1738, #1739, #1708, #1757 | Bug fixes (unit-tested; #1760/#1763 already hand-tested today) | P1                                           |
| #1737                             | Session-history failures surfaced                              | P1                                           |
| #1731                             | Generated images named after real format                       | P3 (pending)                                 |
| #1720                             | 404 detection                                                  | P1                                           |
| #1710                             | Tablet keyboard                                                | P2 mobile pass (partial — emulation only)    |
| #1681                             | Thinking on for all Gemini models                              | P3 (pending)                                 |
| #1677, #1676                      | API-key picker stores `''` when cleared / input events         | P1                                           |

Docs changed: agent-mode, background-tasks, completions, faq, getting-started, ollama/openai/openrouter setup, provider-capabilities, settings.

## Pass 1 — Smoke ✅

| Check               | Result                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `format-check`      | ✅                                                                        |
| `lint`              | ✅                                                                        |
| `lint:cycles`       | ✅ 0 cycles                                                               |
| `build`             | ✅                                                                        |
| `typecheck:test`    | ✅                                                                        |
| `knip`              | ✅                                                                        |
| `vitest --coverage` | ✅ **4,646 passed / 215 files**, thresholds met (was 3,379 on 2026-07-10) |

## Pass 2 — UI + state (no API spend)

| #   | Surface                                            | Verdict            | Notes                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CLI preflight + plugin reload                      | ✅                 | All required subcommands present; `dev:errors` clean after reload                                                                                                                                                                                                                                                                                                                                         |
| 2   | Command palette                                    | ✅                 | 30 `gemini-scribe:*` commands, every one referenced in docs                                                                                                                                                                                                                                                                                                                                               |
| 3   | Settings home                                      | ✅                 | Summary: "Providers Gemini · OpenAI · OpenRouter", "Features Web and research on Gemini · Media on OpenRouter"; sections Chat/Vault/Automation/Advanced/Documentation; index "On · 52 files"                                                                                                                                                                                                              |
| 4   | Providers subpage [NEW #1736/#1761]                | ✅                 | All 5 cards Connected                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | #1761 negative — missing secret                    | ✅                 | Pointed Anthropic at a nonexistent secret → card "Not set up"; restored                                                                                                                                                                                                                                                                                                                                   |
| 6   | Features subpage                                   | ✅                 | Every route matches saved settings (chat OpenAI gpt-5.6-luna; summary/rewrite/completions/image on OpenRouter; web + deep research on Gemini; RAG Google File Search)                                                                                                                                                                                                                                     |
| 7   | Scheduler presets                                  | ✅                 | Time picker on "Daily at time"/"Weekly on days at time"; 7 day checkboxes on weekly; interval input on Custom (`scheduler-new.png`)                                                                                                                                                                                                                                                                       |
| 8   | Modals (12 commands)                               | ✅                 | scheduler, scheduled tasks, hook manager (hooks-disabled state), new hook, background tasks, browse sessions, session settings, release notes, switch project, generate image (open only), RAG status (Ready, 52). `ask-selection` no-op without selection — expected                                                                                                                                     |
| 9   | State folder layout                                | ✅                 | Agent-Sessions, Background-Tasks, Prompts, Skills, Scheduled-Tasks, Scheduled-Tasks/Runs, History present; Hooks absent (correct — `hooksEnabled` off)                                                                                                                                                                                                                                                    |
| 10  | Agent view — plan mode                             | ✅                 | Plan pill toggles on/off                                                                                                                                                                                                                                                                                                                                                                                  |
| 11  | Agent view — skill picker                          | ✅                 | Wand opens picker listing `gemini-scribe-help`                                                                                                                                                                                                                                                                                                                                                            |
| 12  | Agent view — `@` file picker                       | ✅                 | Real keystroke `@` + "Pizz" → suggests "Pizza in San Jose.md" (first attempt via `execCommand` didn't trigger it — harness artefact, not a bug)                                                                                                                                                                                                                                                           |
| 13  | Session-settings model picker search               | ✅                 | Lists 9 OpenAI models incl. gpt-6 / gpt-6.1 [NEW #1762]; "6.1" filters to 2, nonsense → 0, clear → 9 (`model-picker-search.png`)                                                                                                                                                                                                                                                                          |
| 14  | Refresh model list [NEW #1754]                     | ✅                 | Notice "Model list updated: 26 models."; Gemini probe `reachable`                                                                                                                                                                                                                                                                                                                                         |
| 15  | Catch-up — desktop                                 | ✅                 | Planted overdue `runIfMissed` task → status-bar `!` badge "1 missed scheduled run"; nothing auto-ran; click opens "Missed scheduled runs" with Run/Skip/Run all/Skip all                                                                                                                                                                                                                                  |
| 16  | Catch-up — mobile                                  | ✅                 | Under `dev:mobile on` the modal auto-opens on startup, as documented                                                                                                                                                                                                                                                                                                                                      |
| 17  | Mobile — agent view / scheduler / session settings | ✅                 | Input + toolbar render, no overflow; screenshots `mobile-*.png`                                                                                                                                                                                                                                                                                                                                           |
| 18  | Console                                            | ✅                 | No errors captured across the pass                                                                                                                                                                                                                                                                                                                                                                        |
| 19  | Settings defaults vs docs                          | ⚠️ (minor doc gap) | Every `DEFAULT_SETTINGS` value matches `docs/reference/settings.md` (tool policy `cautious`, OpenAI base URL, compaction range 5–50, schema v2); removed-settings table accurate. Gaps only (filed as #1781): `apiKeySecretName` row states no default (others say `""`); docs never say every `features.*` route starts at `{gemini, ''}`. `advanced-settings.md` referenced by the skill doesn't exist. |

Cleanup after Pass 2: test task + state restored (`cmp` identical to backup), `data.json` unchanged from backup, mobile emulation off, 0 modals open.

## Pass 3 — API spend (approved by maintainer, incl. deep research)

Estimated spend: ~$3–5. Deep research alone used 3.18 M tokens (2.70 M input, 111 k output, 370 k thinking).

| #   | Check                                                  | Route                                      | Verdict | Evidence                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Agent chat + `read_file` tool                          | OpenAI gpt-5.6-luna (Responses API, #1763) | ✅      | Answered "Mazza Pizza n Grill", which matches the first entry in `Pizza in San Jose.md`; 7 s; 1 tool completed                                                                                                                                                              |
| 2   | Agent `vault_semantic_search`                          | Google File Search (RAG)                   | ✅      | Returned `Pizza in San Jose.md`                                                                                                                                                                                                                                             |
| 3   | Agent `google_search`                                  | Gemini                                     | ✅      | Cautious policy asked for permission → Allow → cited one-sentence answer (17 s)                                                                                                                                                                                             |
| 4   | Agent `generate_image` with `background: true` [#1731] | OpenRouter                                 | ✅      | Background task returned the output path at once; file is a real PNG (1024×1024) with a `.png` extension                                                                                                                                                                    |
| 5   | Palette **Generate image** modal                       | OpenRouter                                 | ✅      | Image in 9 s, real PNG, embedded in the active note, modal closed                                                                                                                                                                                                           |
| 6   | Agent `deep_research` with `background: true`          | Gemini Deep Research agent                 | ❌      | Submitted fine (task ID returned immediately, ran in the background, no console errors). Finished after **~48 min**, but the saved note is **145 bytes**: the title, the date and an empty `# Research Report` heading (`deep-research-empty-output.md`). See finding below |
| 7   | Summarize active file                                  | OpenRouter (Gemini 3.8 Flash)              | ✅      | Wrote an accurate one-sentence `summary:` frontmatter key                                                                                                                                                                                                                   |
| 8   | Rewrite selection                                      | OpenRouter                                 | ✅      | Instruction "in French" replaced only the selected line; the rest of the note was preserved                                                                                                                                                                                 |
| 9   | Completions [#1739]                                    | OpenRouter (Gemini 3.5 Flash Lite)         | ✅      | Typed "…red, y" → ghost text "ellow, and blue." (continues mid-word without splitting the word); toggle restored to off                                                                                                                                                     |
| 10  | Scheduled task `runNow` + tool call                    | Chat route (OpenAI)                        | ✅      | Run note at `Runs/zz-sched-test/2026-11-21.md` with `scheduled_task`/`ran_at` frontmatter; listed the note's first three pizzerias exactly                                                                                                                                  |
| 11  | Console                                                | —                                          | ✅      | `dev:errors` clean after every check                                                                                                                                                                                                                                        |

### Finding (❌): deep research saves an empty report when RAG is on

> **Update:** fixed by #1778. The [4.14.0 smoke test](SMOKE-4.14.0.md) re-ran it with RAG on: the tools were `[file_search, google_search]`, and the job saved a 50 KB report with 64 web citations.

**This bug already exists in 4.13.0; this release didn't introduce it.** 4.13.0 shipped the same `@allenhutchison/gemini-utils ^1.3.0`, and `src/services/deep-research.ts` hasn't changed since #1539.

What I saw:

- I fetched the interaction directly (`GET /v1beta/interactions/{id}`). It shows `status: completed`, but `steps` holds only the `user_input` step. There's no `model_output` step, even though the agent spent 111 k output tokens. `extractOutputs()` therefore found nothing, and the gemini-utils `ReportGenerator` returned a bare `# Research Report`.
- `tools` on the interaction is `[{type: "file_search", …}]` only. **No `google_search`.**

Likely cause (from reading the code; I didn't re-run to confirm):

- `getFileSearchStoreNames('both')` returns the RAG store whenever RAG is configured.
- `DeepResearchService.conductResearch` passes only `fileSearchStoreNames` to `startResearch`.
- gemini-utils 1.x `buildResearchTools` adds `google_search` only when `googleSearch: true` is passed. Once any tool is set, the agent's default tools no longer apply.
- So the default "both" scope actually runs **vault-only** whenever RAG is on. The test question (tablet keyboards) can't be answered from this vault (pizza notes), and the agent returned no output.

Two things to fix:

1. Pass `googleSearch: true` for the `both` and `web_only` scopes.
2. Treat an interaction that completed with no `model_output` content as a failure, instead of saving an empty note and reporting success. The background task panel currently shows it as completed.

Recommendation: **fix before release** if possible. Deep research with RAG enabled, which is the documented default scope, produces nothing useful and still costs real money (~3 M tokens here). Because 4.13.0 has the same bug, shipping without the fix is no worse than what users have now.

### Observation (⚠️, minor, not a release blocker)

- **Orphaned tool confirmation.** I sent a second agent message programmatically while the first turn was waiting on a Google Search permission request. The second turn ran normally. The first turn's **Allow / Cancel** card stayed on screen, and clicking **Allow** later removed the card but never resumed that turn. `AgentViewSend.sendMessage()` has no in-flight guard. I did not confirm whether the real UI lets a user reach this state (the Send button shows Stop while a turn is running), so it may only be reachable through `sendMessageProgrammatically`. Worth a follow-up issue: block the send, or settle the pending confirmation as cancelled when a new turn starts. Filed as #1780.

### Not covered

- **#1681 (thinking on every Gemini model):** chat is routed to OpenAI in this vault, so no Gemini chat turn ran. Unit tests cover it.
- **#1710 (tablet keyboard):** desktop mobile emulation can't produce a virtual keyboard; this needs a real iPad.
- **Ollama:** excluded here; covered in [`SMOKE-4.14.0.md`](SMOKE-4.14.0.md). Direct Ollama Cloud chat failed there (#1785), fixed by #1786; see [`RETEST-1786.md`](RETEST-1786.md).

## Verdict

> **Update (4.14.0 smoke test):** the deep research ❌ is fixed (#1778). One new ❌: direct Ollama Cloud chat is blocked by CORS (#1785). See [`SMOKE-4.14.0.md`](SMOKE-4.14.0.md).
>
> **Update (2026-11-22):** #1785 is fixed by #1786; the re-test passes (two pre-existing caveats filed as #1790 and #1791). See [`RETEST-1786.md`](RETEST-1786.md).

**Ready to release with one caveat.** Pass 1 is clean, Pass 2 has 18 ✅ / 1 ⚠️ (doc gap), and Pass 3 has 10 ✅ / 1 ❌ plus 1 ⚠️ observation.

- Everything this release changed works: OpenRouter, Gemini model discovery, GPT-6 / Responses API, provider cards, image naming, mid-word completions.
- The ❌ is deep research with RAG enabled. It's already broken in 4.13.0, so it isn't a regression from this release. It's cheap to fix (one flag plus an empty-output guard), and I'd fix it before tagging, or at least file it.
- Neither ⚠️ blocks the release.

## Cleanup

Settings `data.json` restored from backup and verified with `cmp`. Scheduled-tasks state restored. Test sessions, the `zz-test/` notes, the `zz-sched-test` task and its run note, and the generated images are all removed. Mobile emulation and completions are off, and debug mode is back to its prior state.
