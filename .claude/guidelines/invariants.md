# Load-bearing invariants — Gemini Scribe

Repo-specific invariants that CI **doesn't** fully catch and that a reviewer/audit must check a
diff against. Breaking one of these is a correctness or architecture regression, not a style nit.

## API layer: Factory + Decorator

```
src/main.ts → ModelClientFactory.createFromPlugin() → GeminiClient | OllamaClient → RetryDecorator → ModelApi
```

- The factory (`src/api/factory.ts`) branches on `settings.provider` to instantiate a `GeminiClient`
  or `OllamaClient`, wrapped by `RetryDecorator` (exponential backoff) for resilience.
- All provider implementations conform to the `ModelApi` interface; provider-specific code stays
  encapsulated under `src/api/providers/{gemini,ollama}/`. Don't leak provider specifics upward.
- The factory serves distinct use cases (chat, summary, completions, rewrite) — keep them distinct.

## Session-history parser invariant

`SessionHistory.parseHistoryContent` identifies entries by their **callout**
(`[!user]` / `[!assistant]` / `[!reasoning]`), **not** by a `## ` header, and walks **every**
callout in a `---`-delimited section (reasoning + tool callouts flow together, divider-free). Model
reasoning is stored on `GeminiConversationEntry.thoughts` and serialized as a collapsed
`> [!reasoning]-` callout; message turns carry a `## ` header + Message Info table, reasoning-only
turns are the bare callout with no header. This keeps the divider-free activity stream, headerless
reasoning, and legacy per-entry files all round-tripping. **Preserve it**, and cover any format
change with old-format fixtures in `test/agent/session-history.test.ts`.

## AgentLoop (`src/agent/agent-loop.ts`)

- UI-agnostic class that drives the tool-execution loop after the initial model response. **UI side
  effects flow through optional `AgentLoopHooks`** (`onToolCallStart`, `onModelReasoning`,
  `onMidLoopCompaction`, `onFollowUpStreamReady`, …) — the engine never renders directly.
- `AgentLoopOptions.confirmationProvider` is **required**; the engine never looks it up on the
  plugin (UI callers pass the `AgentView`; headless callers pass an auto-approve/deny provider).
- **Headless callers (e.g. scheduled-task runners) must consume `AgentLoop`**, not reimplement the
  loop.
- After each tool batch, `ContextManager.prepareHistory` is called with `protectFromIndex` pinned to
  the start of the current turn's tool-loop turns, so mid-flight compaction can **never** fold the
  in-flight `functionCall`/`thoughtSignature` continuity into a summary (only pre-loop turns are
  eligible) (#662).
- The lazy `require('./agent-factory')` inside `AgentLoop.run` deliberately breaks the
  `AgentFactory` ↔ loop import cycle — **keep it**; don't hoist to a top-level import.
- Loop detection: identical tool calls flag `loopDetected: true`; `AgentLoop` aborts the turn after
  `AGENT_LOOP_ABORT_THRESHOLD` (3) fires (`loopAborted: true`, surfaced but **not** persisted).

## Acyclic module graph — never import `main.ts`

Components reference the plugin only via the leaf interface `src/types/plugin.ts`
(`import type { ObsidianGemini } from '../types/plugin'`), with service handles contributed by
module augmentation in `src/types/plugin-services.ts`. A type reference back to `../main` folds the
graph into hundreds of cycles (#1155). The baseline is **zero circular imports**, enforced by
`npm run lint:cycles` (madge) in the lint CI workflow — keep it at zero. A new plugin service handle
must be added in **both** `main.ts` and `plugin-services.ts` (the `implements` clause won't compile
otherwise).

## Generated artifacts & state layout

- `main.js`, `manifest.json`, `styles.css` are committed at the **repo root** for Obsidian —
  commit them alongside source changes. Version fields in `package.json` / `manifest.json` /
  `versions.json` are managed by `npm version` only (see `release.md`) — never hand-edit.
- `src/services/generated-help-references.ts` is auto-generated at build from `docs/guide/` and
  `docs/reference/`; adding/removing a markdown file there updates the bundled help skill
  automatically — never hand-edit the generated file.
- Plugin state lives under a structured state folder (`settings.historyFolder`, default
  `gemini-scribe`): `History/` (legacy v3.x), `Prompts/`, `Agent-Sessions/`, `Skills/`,
  `Scheduled-Tasks/`, `Background-Tasks/`, `Hooks/`, with automatic migration from the old flat
  layout. Always exclude the state folder **and** `.obsidian` from vault file operations.

## Tool execution ordering

When the agent performs multiple operations in a batch, **reads run before writes/deletes** — the
pipeline sorts tool calls accordingly to prevent races where a file is deleted before being read.

## Documentation is mandatory (hard repo rule)

Every code change ships its documentation updates **in the same PR/commit** — README for
user-facing changes, the relevant `docs/` guides, settings reference for settings changes. Outdated
docs are treated as worse than none. An audit/review should flag a user-facing diff that lands with
no doc update.
