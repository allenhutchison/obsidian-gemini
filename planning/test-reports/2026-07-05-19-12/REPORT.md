# Plugin acceptance test (re-verification pass) — 2026-07-05

## Scope

- **Vault:** Test Vault
- **Plugin version:** 4.10.2 (unreleased; master ahead of tag)
- **Purpose:** Confirm the three fixes merged this session hold end-to-end before tagging:
  - Finding 1 (#1152) — Gemini ↔ Ollama provider round-trip preserves each provider's model
  - Finding 2 (#1151) — Deep Research works on @google/genai 2.x
  - Finding 3 (#1153) — error classifier no longer mislabels non-network errors
- **Focus:** tight confirmation pass, not a full surface walk.

## Pass 1 — Smoke

✅ **build** — tsc + esbuild clean
✅ **typecheck:test** — clean
✅ **npm test** — 3359 passed (155 files)
✅ **format-check** — source clean (only stale planning/ report artifacts flagged)

## Pass 2 — UI + state

| Surface                                     | Verdict | Notes                                                                                                                       |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Fresh master build install + reload         | ✅      | `ollamaModelName` field present on settings → #1152 code is live; no uncaught errors                                        |
| **Finding 1 — provider round-trip (#1152)** | ✅      | Live: Gemini→Ollama→Gemini keeps `chatModelName=gemini-3.1-flash-lite`; `ollamaModelName=gemma4:31b-mlx` held independently |
| **Finding 3 — error classifier (#1153)**    | ✅      | Pure logic; verified via unit tests in Pass 1 (94 error-utils tests incl. 2 new regression tests)                           |
| Agent view                                  | ✅      | Renders: brand mark, capabilities, recent sessions, gradient send, RAG index 46                                             |
| Folder layout                               | ✅      | Agent-Sessions/, Background-Tasks/, Prompts/, Skills/, Scheduled-Tasks/, Runs/ all present                                  |
| Console errors                              | ✅      | None beyond the known NodeJS-package toasts (Finding 4, tracked in #1154)                                                   |

**Result: 6 ✅ / 0 ⚠️ / 0 ❌**

## Pass 3 — API spending

Not run — user opted to stop after Pass 2. Finding 2 (#1151, Deep Research on genai 2.x) remains verified by unit tests + the live end-to-end run performed earlier this session (before merge), but was not re-confirmed against merged master in this pass.

## Recommendation

**Ship-ready** for the two live-confirmed fixes. Pass 1 fully green (3359 tests); Pass 2 confirmed Finding 1 (#1152) live and Finding 3 (#1153) via tests, with no new issues. The only unre-verified item is a live Deep Research call (Finding 2 / #1151) — covered by unit tests and an earlier live run this session; re-run Pass 3 before tagging if you want belt-and-suspenders confirmation.

## Known / tracked

- Finding 4 (#1154) — NodeJS-package load toasts / mobile-compat gap. Pre-existing, non-blocking, tracked.
