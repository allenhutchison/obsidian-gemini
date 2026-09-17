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
	/** SecretStorage key holding the Anthropic API key, mirroring `apiKeySecretName`. */
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
}
