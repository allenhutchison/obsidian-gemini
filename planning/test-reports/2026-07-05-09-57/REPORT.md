# Plugin acceptance test — 2026-07-05

## Scope

- **Vault:** Test Vault
- **Plugin version:** 4.10.2 (manifest not yet bumped past last tag)
- **Last release:** 4.10.2 (2026-06-26)
- **Surfaces tested:** 14
- **Surfaces marked NEW (since 4.10.2):** Plan Mode, design system, SVG rasterize, background-execution default, Ollama single-model, RAG rename
- **Note:** The test vault had a **stale build** installed (pre-#1132). Rebuilt from working tree and ran `install:test-vault` so Pass 2 exercised the actual release candidate.

## Pass 1 — Smoke

✅ **format-check** — all files Prettier-clean
✅ **build** — `tsc -noEmit` + esbuild bundle clean; generate-refs up to date
✅ **typecheck:test** — `tsc --project tsconfig.test.json` clean (exit 0)
✅ **npm test** — **3301 passed** (153 files), up from 2835 at the last report (2026-05-17). No coverage loss.

New test files since 4.10.2 include `svg-rasterizer.test.ts` (189 lines), `init-error-message.test.ts`, `obsidian-settings.test.ts`.

## Pass 2 — UI + state

| Surface                                | Verdict | Notes                                                                                                                                                                       |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings (General)                     | ✅      | Design-token cards; provider=Gemini, models set, API key configured (keychain)                                                                                              |
| Command palette                        | ✅      | 25 commands; IDs de-prefixed per #1132 (`gemini-scribe:open-agent-view`), match docs                                                                                        |
| Folder layout                          | ✅      | Agent-Sessions/, Background-Tasks/, Prompts/, Skills/, Scheduled-Tasks/, Runs/ all present                                                                                  |
| Agent view (empty state)               | ✅      | Gradient brand mark, capability list, Update-vault-context card, recent sessions                                                                                            |
| **Plan Mode toggle (#1046)**           | ✅      | `toggle-plan-mode` command + accent "Plan" pill; toggles active↔inactive correctly                                                                                          |
| Design system (accent/gradient)        | ✅      | Gradient send button, brand mark, elevated cards, accent buttons throughout                                                                                                 |
| Scheduler modal                        | ✅      | Opens clean; "New task" accent button; proper empty state                                                                                                                   |
| **Scheduler presets (6)**              | ✅      | Once / Daily(24h) / Daily at time / Weekly(7d) / Weekly on days at time / Custom — labels match docs; conditional time picker + day checkboxes render for the right presets |
| Scheduler New Task form                | ✅      | Slug, schedule, tool-policy inherit checkbox, prompt, advanced options                                                                                                      |
| Background tasks panel                 | ✅      | Background tasks / RAG tabs; correct empty state                                                                                                                            |
| RAG index status modal                 | ✅      | Status Ready, 46 files indexed, 0 pending; **"Rescan vault"** button confirms #1056 rename (no "Reindex All")                                                               |
| **Ollama single-model picker (#1125)** | ✅      | Provider→Ollama shows one "Ollama model" picker + local-only feature notice; matches provider-capabilities.md. Restored to Gemini after.                                    |
| Mobile rendering                       | ✅      | `dev:mobile on` → plugin loads, `app.isMobile:true`, agent view renders, no uncaught errors. Emulation toggled off after.                                                   |
| **NodeJS package load notices**        | ⚠️      | See finding below                                                                                                                                                           |

**Result: 13 ✅ / 1 ⚠️ / 0 ❌**

### ⚠️ Finding — NodeJS builtin loads surface as Notice toasts on plugin load

On every plugin (re)load, Obsidian raises a cascade of user-visible Notice toasts:
`gemini-scribe attempted to load NodeJS package: "path" / "fs" / "crypto" / "url"`
(also logged as console errors). These come from a **bundled dependency** (Google GenAI / MCP SDK) — the plugin source has zero direct node requires, and the svg-rasterizer uses canvas, not node builtins.

- **Not a regression.** `isDesktopOnly: false` has been set since the **initial commit (2024-10-23)**, and there are **no dependency or manifest changes** in the 4.10.2..HEAD diff. This behavior predates this release.
- **Not fatal.** The plugin loads and functions under mobile emulation with no uncaught errors — the node-builtin loads fail/no-op gracefully at startup.
- **Impact:** Poor first-run/reload UX (toast spam) and a genuine latent mobile-compatibility gap for a plugin that advertises mobile support.
- **Recommendation:** File a tracked issue to either (a) set `isDesktopOnly: true` if mobile isn't truly supported, or (b) lazy-guard the node-builtin code paths so mobile stays clean. **Does not block this release.**

## Pass 3 — API spending (authorized: full)

| Check                                                            | Verdict | Evidence                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground chat round-trip                                       | ✅      | "PONG" in ~1s via `gemini-3.1-flash-lite` (after fixing the model — see Finding 1). Session also auto-titled itself "Connectivity Test".                                                                                                                                                                                          |
| Image generation (agent tool, background)                        | ✅      | Agent chose `background: true` (#1085), inline permission card shown + approved, background task completed, valid 1024×1024 PNG of a correct solid red circle landed at the predicted `test-red-circle.png`.                                                                                                                      |
| Scheduled task `runNow`                                          | ✅      | Created transient `acceptance-test-ping` (schedule `daily`), ran it: output at `Runs/acceptance-test-ping/2026-07-05.md` with correct frontmatter (`scheduled_task`, `ran_at`) and content ("SCHEDULED"); state updated (`lastRunAt`, `nextRunAt`, `consecutiveFailures: 0`). Refactored scheduled-tasks package (#1123) healthy. |
| Deep research                                                    | ❌      | **Completely broken — see Finding 2.** Both attempts failed; direct call throws "SDK structure has changed and proxyFetch injection failed" on init.                                                                                                                                                                              |
| Permission system, token/cache indicators, background-task panel | ✅      | Inline permission cards work; token counter + "65% cached" prompt-cache indicator update live; background task manager tracks image-gen/scheduled/deep-research with correct statuses.                                                                                                                                            |

**Cost:** ~$0.05 actual (1 image + a few one-shot chats + scheduled run; deep research threw before spending). All generated artifacts cleaned up; vault restored (provider Gemini, chat model `gemini-3.1-flash-lite`, empty scheduled-task state).

---

## 🐛 Findings & proposed fixes

### Finding 1 — Provider round-trip silently discards the Gemini chat model (NEW this cycle, #1125/#1077) — **fix before release**

**What:** Switching provider Gemini → Ollama → Gemini silently changes the user's chat model. The Ollama single-model picker (#1125) is bound to the **shared `chatModelName`** field (both provider branches in `settings-general.ts` bind the same key; confirmed by the `#1077` comment). Switching to Ollama overwrites `chatModelName` with an Ollama model; switching back, `selectModelSetting` (settings-helpers.ts:247) heals the now-invalid value to `availableModels[0]` = `gemini-pro-latest` — **not** the user's prior choice.

**Impact:** A user who tries Ollama and returns to Gemini is silently moved from their chosen model (e.g. the cheap `gemini-3.1-flash-lite` default) to `gemini-pro-latest` (the pricier Pro model), with no notice. Contradicts `provider-capabilities.md` ("no data is lost… settings persist across switches"). `summaryModelName`/`completionsModelName` are unaffected (separate fields).

**Also observed (robustness):** When `chatModelName` is invalid for the active provider (reachable if the settings heal never renders — e.g. provider changed programmatically), the agent send path produces **no response and no error** — the user's turn is left dangling in the session file. The send path should validate the model / surface the API error rather than silently no-op.

**Proposed fix:** Give Ollama its own persisted model field (e.g. `ollamaModelName`) and resolve the active model provider-aware (`provider === 'ollama' ? ollamaModelName : chatModelName`) at the ~15 read sites (or via one `getActiveChatModel()` helper). That keeps each provider's choice intact across switches. Add a test covering a Gemini→Ollama→Gemini round-trip asserting `chatModelName` is preserved.

### Finding 2 — Deep Research is completely broken (pre-existing since ≥4.10.2) — **decision needed before release**

**What:** `deep_research` throws on init every time: _"Failed to initialize research client: SDK structure has changed and proxyFetch injection failed."_ (`deep-research.ts:65-73`). The service uses Google's **Interactions API** and manually injects `proxyFetch` into `genAI.interactions._client.fetch` — a workaround the code comments say was written for **`@google/genai` v0.14.x**. The installed version is **`^2.10.0`**, where `interactions._client` no longer exists, so the fail-fast `throw` fires before any network call.

**Scope:** `@google/genai` was already `^2.10.0` at the 4.10.2 tag, so deep research has been broken since **at least 4.10.2** — a documented headline feature (`docs/guide/deep-research.md`, listed ✓ in `provider-capabilities.md`) shipping non-functional. Not a regression introduced this cycle, but release-relevant.

**Proposed fix:** Update the proxyFetch wiring for `@google/genai` 2.10.x — inspect the 2.10 `interactions` client to find the current fetch injection point, or (better) check whether 2.10 respects `httpOptions.fetch` on the constructor for interactions, which would let the fragile `_client` workaround be dropped entirely. Add a deep-research **init smoke test** so an SDK bump can't silently re-break it.

### Finding 3 — Misleading error message masks Finding 2 (minor)

The actionable "SDK structure changed — update the plugin / report issue" error is surfaced to the user as **"Network error: Unable to reach the model API. Please check your connection."** because `error-utils.ts:236` classifies any message containing `fetch` as a network error — and the real message contains "proxy**Fetch**". Users are sent to debug connectivity instead of seeing the real cause. **Fix:** tighten the `includes('fetch')` heuristic (e.g. require `failed to fetch`/`networkerror`) so it doesn't swallow unrelated errors that merely mention "fetch".

### Finding 4 — NodeJS-package Notice toasts on plugin load (pre-existing, ⚠️)

Covered in Pass 2. On every load, Obsidian shows user-visible toasts "attempted to load NodeJS package: path/fs/crypto/url" from a bundled dep. `isDesktopOnly: false` since the initial commit; no dep/manifest change this cycle. Toast spam + latent mobile gap; recommend a tracked issue (mark desktop-only or lazy-guard the node requires). Not a blocker.

---

## Recommendation

**HOLD** — do not tag until at least Finding 1 is fixed:

- **Finding 1** is a real regression introduced this cycle (#1125) with a cost implication (silently upgrades users to the Pro model). It should be fixed before release.
- **Finding 2** (deep research broken) is severe — a documented feature is non-functional — but pre-existing since ≥4.10.2, so it's a maintainer call whether to fix now or track and ship. Given it's user-visible and documented as working, fixing (or at minimum documenting the breakage) is strongly advised.
- **Findings 3 & 4** are low-priority follow-ups; track them.

Everything else is solid: Pass 1 fully green (3301 tests), Pass 2 13✅/1⚠️, and chat / image-gen / scheduled-tasks all verified working end-to-end against the live API.

## Doc gaps surfaced

None new. The command-ID prefix change (#1132) is internal; docs already reference the de-prefixed IDs. Design-system changes are documented in `docs/contributing/design-system.md` (appropriate — not user-guide material).
