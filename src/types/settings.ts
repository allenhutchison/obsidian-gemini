import type { GeminiModel, ModelProvider } from '../models';
import type { ProviderUseCase } from '../api/providers/registry';
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
	 * Primary model provider — serves every use case without an explicit
	 * override. 'gemini' is the cloud default; 'ollama' targets a local daemon.
	 */
	provider: ModelProvider;
	/**
	 * Sparse per-use-case provider overrides (#704). An absent key means "use the
	 * primary", so an install that predates this feature keeps behaving exactly
	 * as before with an empty map — no migration required.
	 *
	 * A use case is only ever routed to a provider that supports it; the
	 * resolver never substitutes a different provider for one that can't serve a
	 * feature (see `api/provider-routing.ts`), so enabling a cloud feature under
	 * a local primary is always a deliberate choice.
	 */
	providerOverrides: Partial<Record<ProviderUseCase, ModelProvider>>;
	/** Base URL for the Ollama HTTP API. Only used when Ollama serves some use case. */
	ollamaBaseUrl: string;
	/** Optional custom base URL to override the default Google Gemini API endpoint. */
	customBaseUrl: string;
	apiKeySecretName: string;
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	imageModelName: string;
	/**
	 * Default model for every Ollama-served use case (Ollama keeps one model
	 * resident at a time). Stored separately from the Gemini fields above so
	 * switching a use case between providers preserves each provider's choice.
	 */
	ollamaModelName: string;
	/**
	 * Optional per-use-case Ollama models. Empty string — the default — means
	 * "inherit `ollamaModelName`", which keeps the single-resident-model
	 * behaviour of #1077 out of the box. Set one only if the extra model swap is
	 * worth the RAM/VRAM churn (e.g. a tiny completions model).
	 */
	ollamaSummaryModelName: string;
	ollamaCompletionsModelName: string;
	summaryFrontmatterKey: string;
	userName: string;
	chatHistory: boolean;
	historyFolder: string;
	debugMode: boolean;
	fileLogging: boolean;
	maxRetries: number;
	initialBackoffDelay: number;
	streamingEnabled: boolean;
	/**
	 * Use Google's GA Interactions API (`client.interactions.create`) as the
	 * Gemini transport instead of the legacy `generateContent`. Runs stateless
	 * (`store: false`); we still own and replay conversation history. Default-on
	 * as of the default-on rollout (#1017); `generateContent` stays reachable as
	 * a fallback — see epic #1013.
	 */
	useInteractionsApi: boolean;
	/**
	 * Internal marker for the one-time default-on migration (#1017): once the
	 * false→true flip has run for an existing install, we never re-run it, so a
	 * user who deliberately turns the transport back off is respected. New
	 * installs are seeded `true` and skip the migration entirely.
	 */
	useInteractionsApiMigrated?: boolean;
	allowSystemPromptOverride: boolean;
	temperature: number;
	topP: number;
	stopOnToolError: boolean;
	// Tool loop detection settings
	loopDetectionEnabled: boolean;
	loopDetectionThreshold: number;
	loopDetectionTimeWindowSeconds: number;
	// Trusted Mode (legacy — migrated to toolPolicy)
	alwaysAllowReadWrite: boolean;
	// Tool policy settings
	toolPolicy: ToolPolicySettings;
	// Version tracking for update notifications
	lastSeenVersion: string;
	// RAG Indexing settings
	ragIndexing: RagIndexingSettings;
	// MCP server settings
	mcpEnabled: boolean;
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
	// IDs of collapsible settings sections currently expanded; persists across reloads.
	expandedSettingsSections: string[];
	// Cached remote model list (managed by ModelListProvider)
	remoteModelCache?: { models: GeminiModel[]; timestamp: number };
}
