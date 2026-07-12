import type { GeminiModel, ModelProvider } from '../models';
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
	/** Active model provider. 'gemini' is the cloud default; 'ollama' targets a local Ollama daemon. */
	provider: ModelProvider;
	/** Base URL for the Ollama HTTP API. Only used when provider === 'ollama'. */
	ollamaBaseUrl: string;
	/** Optional custom base URL to override the default Google Gemini API endpoint. */
	customBaseUrl: string;
	apiKeySecretName: string;
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	imageModelName: string;
	/**
	 * Single model used for every use case under the Ollama provider (Ollama keeps
	 * one model resident at a time). Stored separately from the Gemini fields above
	 * so switching Gemini ↔ Ollama preserves each provider's model choice.
	 */
	ollamaModelName: string;
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
