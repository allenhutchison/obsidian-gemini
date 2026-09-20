# Load-bearing invariants — Gemini Scribe

Repo-specific invariants that CI **doesn't** fully catch and that a reviewer/audit must check a
diff against. Breaking one of these is a correctness or architecture regression, not a style nit.

## API layer: Factory + Decorator, capability-routed

```text
src/main.ts → ModelClientFactory.createFromPlugin() → GeminiClient | OllamaClient | OpenAIClient | AnthropicClient → RetryDecorator → ModelApi
```

- Each call resolves its provider **independently** via `featureProvider(settings, featureId)` in the leaf module
  `src/api/feature-routing.ts`, reading the route stored at `settings.features[featureId]` (`featureRoute`) — the
  dense `features: Record<FeatureId, FeatureRoute>` table. `settings.defaultProvider` never serves a request: it
  only **seeds** entries missing at settings load (`sanitizeFeatureRoutes`), and otherwise feeds display/re-init
  helpers (`activeProviders`, `routingKey`). The factory
  (`src/api/factory.ts`) instantiates the `ModelApi` implementation the resolved provider names (`GeminiClient`, `OllamaClient`, `OpenAIClient`, `AnthropicClient`),
  wrapped by `RetryDecorator` (exponential backoff) for resilience.
- **No silent provider substitution — unconditional.** A feature is served by exactly the provider stored in its
  route, or it is **off**: `featureProvider` returns `null` both for a `'none'` route and for a stored provider
  that can't serve the feature. `'none'` is the only legal repair value — `sanitizeFeatureRoutes` maps unknown
  provider ids and unsupported pairings to `'none'`, never to a substitute. An unservable route throws
  `FeatureUnavailableError` from the factory; the caller surfaces it as a Notice instead of re-routing the request.
  Substituting a cloud provider for a capability a local one lacks would send vault data somewhere the user never
  opted into.
- All provider implementations conform to the `ModelApi` interface; provider-specific code stays encapsulated under
  `src/api/providers/{gemini,ollama,openai,anthropic}/`. Don't leak provider specifics upward: the capability matrix (which
  provider can serve which feature) lives in the leaf module `src/api/providers/registry.ts`, and the routing
  helpers in the leaf module `src/api/feature-routing.ts` — consume them instead of branching on provider name
  literals. `feature-routing` stays a leaf: `models.ts` imports _it_ (for `resolveFeatureModel`), never the
  reverse; `featureModel` returns the stored string verbatim — default-model resolution lives in `models.ts`.
- Routing is total over every `FeatureId` in `FEATURE_IDS` (`src/types/features.ts`) — keep features distinct.
  The factory serves the four use-case features via `FEATURE_FOR_USE_CASE` (`src/api/factory.ts`); the rest
  (`webSearch`, `deepResearch`, `rag`, `imageGen`) resolve the same way at their own consumers (e.g. tool
  registration gates in `src/tools/tool-registrar.ts`) via `featureProvider`/`featureRoute`.
- `ModelUseCase.SEARCH` bills to `chat`, not the `webSearch` feature: it's a thinking-level tier for
  query-understanding calls on the chat path, and routing it to `webSearch` would make a local-only install's chat
  calls hunt for a provider serving web search and find none.

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

- `manifest.json` and `styles.css` are committed at the **repo root** for Obsidian. `main.js` is a
  build output and is **gitignored** — never commit it. Version fields in `package.json` /
  `manifest.json` / `versions.json` are managed by `npm version` only (see `release.md`) — never
  hand-edit.
- `src/services/generated-help-references.ts` is auto-generated at build from `docs/guide/` and
  `docs/reference/`; adding/removing a markdown file there updates the bundled help skill
  automatically — never hand-edit the generated file.
- Plugin state lives under a structured state folder (`settings.historyFolder`, default
  `gemini-scribe`): `History/` (legacy v3.x), `Prompts/`, `Agent-Sessions/`, `Skills/`,
  `Scheduled-Tasks/`, `Background-Tasks/`, `Hooks/`, with automatic migration from the old flat
  layout. Always exclude the state folder **and** `.obsidian` from vault file operations.
- **`src/services/state-folder.ts` is the single source of truth for that layout** (#1382): the
  subfolder names (`STATE_SUBFOLDERS`), root-level state file names (`STATE_FILES`), and the
  `stateFolderPath(settings, ...segments)` helper that applies `normalizePath` exactly once. It is a
  leaf module (imports only `normalizePath` and a type), so every consumer can import it without a
  cycle. **Never hand-build a state path** with ``normalizePath(`${settings.historyFolder}/X`)`` —
  that duplication is what let two UI call sites silently drop `normalizePath`.
  `FolderInitializer` creates `EAGER_SUBFOLDERS`, **derived** from `STATE_SUBFOLDERS` rather than a
  hand-written twin. Two folders are deliberately not eager, and the module says so in one place:
  `Hooks/` (created by `HookManager.initialize`, gated on `settings.hooksEnabled`, so hooks-off
  vaults get no empty folder) and `History/` (read-only v3.x legacy, never created).
  `FolderInitializer` is the **single creator** of `Scheduled-Tasks/` + `Runs/` (#1540):
  `LifecycleService.setup()` runs `initializePluginFolders()` _before_ refreshing the managers on a
  re-init (a first load gets the guarantee from `onLayoutReady()` running the same pass before
  `scheduledTaskManager.initialize()`), so `ScheduledTaskManager.initialize` reads its folders
  instead of creating them. `HookManager` keeps its own `ensureFolderExists` pair because `Hooks/`
  is not eager — the manager is the only code that knows `hooksEnabled`.

## Tool execution ordering

When the agent performs multiple operations in a batch, **reads run before writes/deletes** — the
pipeline sorts tool calls accordingly to prevent races where a file is deleted before being read.

That sort governs **execution** order only. The turn pair replayed back to the model — the `model`
turn of `functionCall` parts and the `user` turn of `functionResponse` parts — stays in the model's
**emitted** order, so each response sits opposite the call it answers and each `thoughtSignature`
stays attached to its own call. `buildToolHistoryTurns` (`src/agent/agent-loop-helpers.ts`) is the
**single enforcement point**: it replays `toolCalls` verbatim and realigns the results onto that
order by the `sourceIndex` stamped on each `ToolCallResultPair` before the sort ran, so the two
arrays are never assumed to be parallel — which is the assumption the sort quietly broke. Callers
owe it one thing in return: pass the array the indices were stamped from (the emitted one, via
`indexToolCalls`), never the sorted one. A batch cut short by cancellation gets a synthetic
`functionResponse` for every call it never reached, so the two turns always carry the same parts in
the same order and no unpaired `functionCall` survives into history (#1499).

## Documentation is mandatory (hard repo rule)

Every code change ships its documentation updates **in the same PR/commit** — README for
user-facing changes, the relevant `docs/` guides, settings reference for settings changes. Outdated
docs are treated as worse than none. An audit/review should flag a user-facing diff that lands with
no doc update.
