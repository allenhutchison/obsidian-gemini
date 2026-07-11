# Plugin acceptance test (scoped delta pass) — 2026-07-10

## Scope

- **Vault:** Test Vault
- **Plugin version:** 4.10.2 (manifest not yet bumped; master ahead of tag — RC for **4.11.0**)
- **Last release:** 4.10.2 (2026-06-26)
- **Prior reports:** `planning/test-reports/2026-07-05-09-57/` (full 3-pass) and `.../2026-07-05-19-12/` (re-verify). Both finalized 2026-07-07.
- **This run is a scoped delta pass, NOT a full surface walk.** The two 07-05 reports cover the full surface. This run covers only what changed since they were finalized.

### Delta since the 07-05 reports (commits after 2026-07-07 14:10)

Almost entirely **behavior-preserving lint/refactor** work — covered by Pass 1:

- #1166 `no-unsafe-*` sweep (slices 2–7) + global enforcement
- #1167 migrate remaining 68 static inline styles to CSS classes
- #1162 **eliminate all 150 circular imports** via a leaf plugin interface (broad; touches many files)
- #1163/#1164 clear last `no-explicit-any`, enforce across src
- #1165 clear + enforce four more softened lint rules
- #1169/#1170 dedup refactors (isSameSession helper, external image/SVG attachment loop)

**One behavioral change** — point-tested in Pass 2:

- **#1154** — stop Node built-ins loading at startup via `gemini-utils` subpaths. This _fixes_ Finding 4 from the 09-57 report (the "attempted to load NodeJS package" Notice-toast spam on load + latent mobile gap).

Non-shipping: #1175 (maintainerd toolkit, tooling only).

### Point-test objectives for Pass 2

1. **#1154 verification** — the `gemini-scribe attempted to load NodeJS package: path/fs/crypto/url` Notice toasts are now **gone** on plugin (re)load; mobile-emulated startup is clean with no such toasts.
2. **#1162 sanity** — the circular-import restructure didn't break runtime: plugin loads clean (no `dev:errors`), agent view renders.

No Pass 3 (API-spending) — no API-path code changed since the 07-05 reports; #1151/#1152/#1153 were already live-confirmed there.

## Pass 1 — Smoke

| Check                                          | Verdict | Evidence                                                                                        |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `format-check`                                 | ✅      | All matched files Prettier-clean                                                                |
| `build`                                        | ✅      | `generate-refs` up to date; `tsc -noEmit` + esbuild bundle clean; exit 0; `main.js` regenerated |
| `typecheck:test` (`tsc -p tsconfig.test.json`) | ✅      | Exit 0                                                                                          |
| `npm test`                                     | ✅      | **3379 passed** (157 files)                                                                     |
| `lint`                                         | ✅      | **0 errors** (36 warnings, all deliberate test-scoped exceptions in `test/`)                    |

**Test-count trend:** 2835 (2026-05-17) → 3301 (07-05 09-57) → 3359 (07-05 19-12) → **3379** (this run, +20 / +2 files). Monotonic increase; no coverage loss.

**Lint note:** this is the first pre-release run where the full `SOFTENED_TS_RULES` + `PERVASIVE_OBSIDIANMD_RULES_TODO` ledger is enforced (`0 errors`) — the #1032 epic that closed today. The Obsidian directory "Review: Caution" flags this release targets are now clean at source.

## Pass 2 — UI + state (point-tested delta only)

Vault guard: ✅ focused vault = `Test Vault` (re-checked at start and end; `isMobile=false` after run). No Gemini API calls in this pass.

| Check                                                  | Verdict | Evidence                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean plugin reload (desktop)                          | ✅      | `dev:errors` = "No errors captured"; 16-line console dump is normal lifecycle (unload → RAG init (46 files) → ScheduledTaskManager → hooks-disabled → projects) with no exceptions                                                                                                                                               |
| **#1154 — NodeJS-package toasts gone (desktop)**       | ✅      | Debugger-attached reload: **0** matches for `NodeJS package` / `attempted to load`; **0** error-level console entries; **0** `.notice` toasts in DOM. (Was ⚠️ Finding 4 in the 09-57 report — cascade of `path/fs/crypto/url` toasts on every load.)                                                                             |
| **#1154 — mobile startup clean**                       | ✅      | `dev:mobile on`, `app.isMobile=true`, reload: **0** node-package matches, **0** errors. Closes the "latent mobile-compat gap" the finding called out. Mobile emulation toggled back **off** (verified `isMobile=false`).                                                                                                         |
| **#1162 — circular-import restructure runtime sanity** | ✅      | Plugin loads clean (above); agent view renders fully on desktop (`01-agent-view.png`) — gradient brand mark, capability list, Update-vault-context card, recent sessions, gradient send, RAG index 46 — and on mobile (`02-mobile-agent-view.png`). Eliminating all 150 circular imports did not disturb load order or the view. |

**Result: 4 ✅ / 0 ⚠️ / 0 ❌**

Screenshots: `01-agent-view.png` (desktop), `02-mobile-agent-view.png` (mobile).

## Pass 3 — API spending

**Not run — intentionally out of scope.** No API-path code changed since the 07-05 reports; the API-relevant fixes (#1151 deep-research proxyFetch, #1152 Ollama model field, #1153 error classifier) were already live-confirmed in `2026-07-05-19-12/REPORT.md`. Nothing in the delta since then (lint/refactor + #1154 startup) touches a Gemini API path.

## Recommendation

**SHIP 4.11.0.** The delta since the 07-05 acceptance run is behavior-preserving refactor work (green Pass 1: 3379 tests, 0 lint errors, clean build/typecheck) plus one behavioral change, #1154, which **fixes** the only open ⚠️ from the prior report (Finding 4) and does so on both desktop and mobile. No regressions surfaced; no findings.

Prior-report findings status going into this release:

- Finding 1 (#1152, Ollama model round-trip) — fixed, live-confirmed 07-05-19-12.
- Finding 2 (#1151, deep research on genai 2.x) — fixed, live-confirmed earlier + unit tests.
- Finding 3 (#1153, error classifier) — fixed, unit-confirmed.
- Finding 4 (#1154, node-package toasts / mobile gap) — **fixed and verified in this run.**

## Doc gaps surfaced

None. The delta is internal refactor + a startup fix; no new user-facing surface.
