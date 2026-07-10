# Testing guidelines — Gemini Scribe

Repo-specific test conventions the `audit-tests` and `code-review` skills enforce. Full manual
procedures (test-vault wiring, mobile testing, smoke checklists) live in
[`docs/contributing/testing.md`](../../docs/contributing/testing.md).

## Framework & layout

- **Vitest** (esbuild-powered, for TypeScript) in a **jsdom** environment for DOM testing.
- Test file pattern: `test/**/?(*.)+(spec|test).[tj]s`.
- Unit tests live in `test/` mirroring the `src/` structure, named after the unit under test
  (`models.test.ts`, `main.test.ts`, `test/agent/session-history.test.ts`).

## What to test

- Assert **observable behavior** of prompts, services, and tool orchestration — not internal
  implementation detail.
- Add **regression coverage for every bug** fixed.
- Priority focus areas: core utility functions; API error scenarios with retry/backoff behavior;
  file-context tree building **and circular-reference prevention**; prompt generation with correct
  template rendering.
- When changing a persisted format (e.g. session history), cover it with **old-format fixtures** so
  round-tripping is proven — e.g. the session-history parser invariant is guarded by old-format
  fixtures in `test/agent/session-history.test.ts` (see `invariants.md`).

## Mocking

- Extend the shared fixtures under `__mocks__/` when mocking a new API rather than hand-rolling a
  one-off mock in the test.

## The `typecheck:test` trap — do not skip it

`npm run build` uses `tsc -skipLibCheck` and **excludes** `test/`, so a green build does **not**
guarantee CI passes. CI runs `npm run typecheck:test` (`tsc --project tsconfig.test.json`)
separately over the `test/` tree. Always run it after changing test files.

> Classic trap: an expression-bodied arrow like `(t) => arr.push(t)` returns `number`, not `void`,
> and **only** the test typecheck flags it.

## Before every PR — full local pre-flight

The pre-commit hook only auto-fixes **staged** files (`lint-staged`), a narrower check than CI's
full-repo, fix-nothing commands. Run all five locally before pushing to avoid a CI-only failure:

```bash
npm run format-check && npm run build && npm test && npm run lint && npm run typecheck:test
```

`npm run build` runs on the pre-push hook; `npm test` too. Formatting, lint, and `typecheck:test`
are **CI-only** gates — a green local build alone is not enough.

## Integration test scripts

After touching agent or tool code, run the relevant end-to-end runners, e.g.:

```bash
node test-scripts/test-sdk-tools.mjs
```

These validate agent toolchains end-to-end (see `test-scripts/` for siblings) and catch breakage
the unit suite can't.
