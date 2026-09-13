import type { GeminiModel, ModelProvider } from '../models';
import type { FeatureRoutes, ProviderModelMemory } from './features';
import type { ToolPolicySettings } from './tool-policy';
import type { MCPServerConfig } from '../mcp/types';

export interface RagIndexingSettings {
	enabled: boolean;
	fileSearchStoreName: string | null;
	excludeFolders: string[];
	autoSync: boolean;
	includeAttachments: boolean;
}

export interface ObsidianGeminiSettings {
	/**
	 * Provider used by any feature not explicitly routed elsewhere. Always a
	 * real provider (never `'none'`) — features that are deliberately off
	 * store that on their own route, not here.
	 */
	defaultProvider: ModelProvider;
	/**
	 * Per-feature provider + model routing (settings redesign; successor to
	 * `provider` + `providerOverrides`). Total over `FeatureId` — every feature
	 * has an entry, `'none'` meaning "not routed, feature is off". A feature is
	 * only ever served by the provider stored in its own route; nothing
	 * substitutes a different one for a route that can't serve it (see
	 * `api/feature-routing.ts`), so enabling a cloud feature under a local
	 * default provider is always a deliberate per-feature choice.
	 */
	features: FeatureRoutes;
	/**
	 * Last model picked for each (provider, feature) pair. Never read when
	 * building a request — it exists only so re-routing a feature away from a
	 * provider and back restores the previous choice (#1077 / #1298).
	 */
	providerModelMemory: ProviderModelMemory;
	/** Base URL for the Ollama HTTP API. Only used when Ollama serves some feature. */
	ollamaBaseUrl: string;
	/** Optional custom base URL to override the default Google Gemini API endpoint. */
	customBaseUrl: string;
	apiKeySecretName: string;
	/**
	 * Base URL for the OpenAI Chat Completions API. Defaults to
	 * `DEFAULT_OPENAI_BASE_URL` (api.openai.com); overridden to target an
	 * OpenAI-compatible local server (LM Studio, MLX, ...).
	 */
	openaiBaseUrl: string;
	/** SecretStorage key holding the OpenAI API key, mirroring `apiKeySecretName`. */
	openaiApiKeySecretName: string;
	/**
	 * SecretStorage key holding an Anthropic API key. Staged ahead of a working
	 * Anthropic client: the settings UI's Anthropic provider card is a
	 * card-only placeholder (`routable: false`, `'anthropic'` is not part of
	 * `ModelProvider`), so nothing reads this yet.
	 */
	anthropicApiKeySecretName: string;
	summaryFrontmatterKey: string;
	userName: string;
	chatHistory: boolean;
	historyFolder: string;
	debugMode: boolean;
	fileLogging: boolean;
	stopOnToolError: boolean;
	// Tool policy settings
	toolPolicy: ToolPolicySettings;
	// Version tracking for update notifications
	lastSeenVersion: string;
	// RAG Indexing settings
	ragIndexing: RagIndexingSettings;
	// MCP server settings
	mcpServers: MCPServerConfig[];
	// Context management
	contextCompactionThreshold: number;
	showTokenUsage: boolean;
	// Diff review
	alwaysShowDiffView: boolean;
	// Tool execution logging
	logToolExecution: boolean;
	// Scheduled task catch-up
	autoRunCatchUp: boolean;
	// Lifecycle hooks (opt-in: AI runs triggered by vault events)
	hooksEnabled: boolean;
	// Cached remote model list (managed by ModelListProvider)
	remoteModelCache?: { models: GeminiModel[]; timestamp: number };
	/**
	 * Schema version for the settings-field shape, keyed off by
	 * `migrateToFeatureRouting` (`src/utils/settings-migrations.ts`). `1` is
	 * implied for any `data.json` without it. New installs are seeded `2`.
	 */
	settingsSchemaVersion: number;

	// --- Tombstones -----------------------------------------------------
	// Removed by the settings redesign: absent from DEFAULT_SETTINGS and from
	// data.json (the migration deletes any persisted value), but kept here as
	// optional so files that haven't yet been migrated off them keep
	// compiling — every remaining reader already guards with `?? default` or
	// `!== false`, so a read now yielding `undefined` reproduces the new
	// fixed-constant behaviour exactly. Deleted once every reader has moved
	// off them (settings-redesign work package: tombstone sweep).

	/** Deprecated: Removed by the settings redesign; replaced by `defaultProvider` + `features`. */
	provider?: ModelProvider;
	/** Deprecated: Removed by the settings redesign; replaced by `features`. */
	providerOverrides?: Partial<Record<string, ModelProvider>>;
	/** Deprecated: Removed by the settings redesign; replaced by `features.chat` / `features.rewrite` / `features.webSearch` + `providerModelMemory`. */
	chatModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `features.summary` + `providerModelMemory`. */
	summaryModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `features.completions` + `providerModelMemory`. */
	completionsModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `features.imageGen` + `providerModelMemory`. */
	imageModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.ollama`. */
	ollamaModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.ollama`. */
	ollamaSummaryModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.ollama`. */
	ollamaCompletionsModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.openai`. */
	openaiModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.openai`. */
	openaiSummaryModelName?: string;
	/** Deprecated: Removed by the settings redesign; replaced by `providerModelMemory.openai`. */
	openaiCompletionsModelName?: string;
	/** Deprecated: Removed by the settings redesign; the retry decorator now uses fixed constants. */
	maxRetries?: number;
	/** Deprecated: Removed by the settings redesign; the retry decorator now uses fixed constants. */
	initialBackoffDelay?: number;
	/** Deprecated: Removed by the settings redesign; the agent always streams. */
	streamingEnabled?: boolean;
	/** Deprecated: Removed by the settings redesign; Gemini always uses the Interactions API. */
	useInteractionsApi?: boolean;
	/** Deprecated: Removed by the settings redesign along with `useInteractionsApi`. */
	useInteractionsApiMigrated?: boolean;
	/** Deprecated: Removed by the settings redesign; every request now uses the provider SDK's own default. */
	temperature?: number;
	/** Deprecated: Removed by the settings redesign; every request now uses the provider SDK's own default. */
	topP?: number;
	/** Deprecated: Removed by the settings redesign; loop detection stays always on with fixed defaults. */
	loopDetectionEnabled?: boolean;
	/** Deprecated: Removed by the settings redesign; loop detection stays always on with fixed defaults. */
	loopDetectionThreshold?: number;
	/** Deprecated: Removed by the settings redesign; loop detection stays always on with fixed defaults. */
	loopDetectionTimeWindowSeconds?: number;
	/** Deprecated: Removed by the settings redesign; an empty `mcpServers` list means off. */
	mcpEnabled?: boolean;
	/** Deprecated: Removed by the settings redesign; the declarative settings API replaces the `<details>` pattern this tracked. */
	expandedSettingsSections?: string[];
}
