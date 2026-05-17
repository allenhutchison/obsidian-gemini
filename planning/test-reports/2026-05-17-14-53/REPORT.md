# Plugin acceptance test — 2026-05-17

Targeted acceptance test of **PR #840** (`feat/cache-stabilization-763`) —
"stabilize system prompt prefix caching (#763)".

## Scope

- Vault: Test Vault
- Plugin version: 4.8.0
- Branch under test: `feat/cache-stabilization-763` (PR #840)
- Base: `master`
- PR intent: move per-turn context (context-file contents + attachment
  metadata) out of the static `systemInstruction` and into the user
  message parts, so the system prompt prefix is byte-stable across turns
  and gets a near-100% prefix cache hit.

### Blast radius (files changed by PR #840)

- `prompts/systemPrompt.hbs` — removed `## Turn Context` block
- `src/prompts/gemini-prompts.ts` — `getSystemPromptWithCustom` no longer takes/renders `perTurnContext`
- `src/api/providers/gemini/client.ts` — static systemInstruction; `perTurnContext` appended to user parts
- `src/api/providers/ollama/client.ts` — same shape for Ollama
- `src/agent/agent-loop-helpers.ts` — `buildToolHistoryTurns` splices `perTurnContext` into the user history turn
- `src/agent/agent-loop.ts` — threads `perTurnContext` into tool-loop history

## Pass 1 — Smoke

✅ `npm run format-check` — clean
✅ `npm run build` — type-check + bundle clean
✅ `npx tsc --noEmit -p tsconfig.test.json` — clean
✅ `npm test` — **2832 passed** (121 files), +55 vs master (PR's new tests). No coverage loss.

## Pass 2 — UI + state (no API)

| Surface           | Verdict | Notes                                         |
| ----------------- | ------- | --------------------------------------------- |
| Plugin load       | ✅      | v4.8.0, `dev:errors` clean after reload       |
| Agent view        | ✅      | chat input + send button + empty state render |
| Context-file chip | ✅      | probe note chip renders above the input       |
| Console           | ✅      | no errors after interaction                   |

PR #840 touches no UI code — Pass 2 confirms nothing broke.

### Test-environment issue found (not a plugin bug)

The Test Vault has **two plugin folders both claiming `id: gemini-scribe`**:
`.obsidian/plugins/gemini-scribe/` and `.obsidian/plugins/obsidian-gemini/`.
Obsidian loads the latter. `npm run install:test-vault` installs to the
former by default, so the first Pass-3 attempt silently tested the **stale
May-12 build**. Re-installed with `TEST_VAULT_PLUGIN_DIR` pointed at the
active folder; all Pass-3 results below are against the real PR build.
**Recommend deleting the stale duplicate folder** so future test runs are
not misdirected.

## Pass 3 — API spending (gemini-3-flash-preview, ~$0.02 actual)

Probe note `gemini-scribe-qa-probe.md` (unique facts: codename
`BLUE-HERON-7741`, widget capacity `4823`, fallback server `Reykjavik`)
added as a context chip. `fetch` was intercepted to capture exact wire
payloads to `generativelanguage.googleapis.com`.

| Check                                                | Verdict | Evidence                                                                                                                                                                                     |
| ---------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context-file content reaches model                   | ✅      | Turn 1 answered `BLUE-HERON-7741` (exists only in the context file)                                                                                                                          |
| `perTurnContext` is in user parts, not system prompt | ✅      | Captured request: `systemInstruction` has no `## Turn Context` / no probe content; user turn has a 2nd text part (673 chars) carrying the context                                            |
| System prompt static across turns                    | ✅      | Turn 1 vs Turn 2 `systemInstruction` **byte-identical** (29,487 chars both)                                                                                                                  |
| Caching benefit materializes                         | ✅      | Turn 1: 0% cached → Turn 2: **71% cached** (8.1k tokens), shown in token UI                                                                                                                  |
| Multi-turn context persistence                       | ✅      | Turn 2 answered `4823` from the context file                                                                                                                                                 |
| Tool-loop context continuity                         | ✅      | After a `list_files` tool call, the model answered `Reykjavik` from the context file                                                                                                         |
| Tool follow-up payload shape                         | ❌→✅   | **Was duplicated** — bug found, fixed, and re-verified (see below)                                                                                                                           |
| Image attachment                                     | ⏭️      | Not tested — no image in vault. PR leaves the `inlineData` bytes path structurally unchanged; only the ATTACHMENTS _metadata text_ moved with `perTurnContext` (already verified). Low risk. |

### ❌ Bug — `perTurnContext` duplicated in tool follow-up / retry requests

**What:** In the tool-execution follow-up request (and the empty-response
retry request), `perTurnContext` is sent **twice**.

**Evidence** — captured `generateContent` follow-up payload, `contents`:

```
[history… t1u, t1m, t2u, t2m]
user  [ text(225 = userMessage) , text(673 = perTurnContext, has probe) ]   ← spliced by buildToolHistoryTurns
model [ functionCall: list_files ]
user  [ functionResponse: list_files ]
user  [ text(673 = perTurnContext, has probe) ]                              ← appended AGAIN by buildContents
```

**Root cause:** `buildToolHistoryTurns` (PR change) now splices
`perTurnContext` into the user turn of `updatedHistory`. But
`buildFollowUpRequest` / `buildRetryRequest`
(`src/ui/agent-view/agent-view-tool-followup.ts`) still also set
`perTurnContext` on the request, and `GeminiClient.buildContents` still
appends it to `userParts`. Both fire → the full context-file payload is
sent twice per tool iteration and per retry.

**Impact:** Medium. Functionally benign (the model answered correctly),
but it directly **undercuts the PR's own goal**. Issue #763 is about token
blow-up in long _coding_ sessions — which are tool-heavy — so every tool
iteration re-sends the entire context-file payload (potentially many KB)
an extra time. It also produces two consecutive `user`-role turns
(functionResponse turn + a trailing text turn).

**A second facet — cross-iteration accumulation:** even setting the
request-level duplication aside, `agent-loop.ts` passed
`perTurnContext` to `buildToolHistoryTurns` on _every_ loop iteration.
Because `userMessage` is `''` after the first iteration, each later
iteration spliced a standalone `perTurnContext` user turn — so an N-tool
loop carried N copies of the context.

### ✅ Fix applied + re-verified

**Code changes:**

1. `src/ui/agent-view/agent-view-tool-followup.ts` — `buildFollowUpRequest`
   and `buildRetryRequest` no longer set `perTurnContext` on the returned
   request. It is already in `updatedHistory` via `buildToolHistoryTurns`,
   so `buildContents` must not append it again. Session-static fields
   (`projectInstructions`, `projectSkills`, `sessionStartedAt`) still
   thread through — they feed the byte-stable system prompt.
2. `src/agent/agent-loop.ts` — `perTurnContext` is now a first-iteration
   input like `userMessage`: a local var passed to `buildToolHistoryTurns`,
   then cleared (`undefined`) when the loop continues, so later iterations
   don't re-splice it.

**Tests:**

- New `test/ui/agent-view/agent-view-tool-followup.test.ts` (3 tests) —
  asserts the follow-up/retry requests omit `perTurnContext` and that the
  context survives in `conversationHistory` exactly once.
- Updated the 3 PR-added tests in `test/agent/agent-loop.test.ts` (the
  `per-turn context propagation` block) — they previously asserted the
  buggy behavior; now they assert `perTurnContext` is absent from the
  request and present exactly once in history, including across a
  multi-iteration loop.
- Full suite: **2835 passed**, format/build/typecheck/lint clean.

**Live re-verification** (fresh session, tool-loop scenario, `fetch`
captured): the `generateContent` tool follow-up now carries the context
**exactly once** —

```
user  [ text(218 = userMessage) , text(673 = perTurnContext, has probe) ]
model [ functionCall: list_files ]
user  [ functionResponse: list_files ]
```

No trailing duplicate turn; model answered `Reykjavik` correctly.

## Recommendation

**SHIP** — with the fix above applied.

The core mechanism is verified end-to-end: the system prompt is now a
byte-stable, cacheable prefix (71% cache hit on turn 2), context files
reach the model correctly, and — after the fix — the per-turn context is
sent exactly once on the initial call, every tool follow-up, and every
loop iteration. This is the behavior issue #763 needs.

## Doc gaps surfaced

None — PR #840 is an internal caching refactor with no user-facing surface.
