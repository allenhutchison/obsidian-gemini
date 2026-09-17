/**
 * Shared plugin/app fixture for the settings-UI package's tree-shape and
 * writer tests (`definitions.test.ts`, `paths.test.ts`). Not itself a test
 * file — `vitest.config.ts`'s `include` glob only picks up `*.test.ts`.
 */
import { DEFAULT_TOOL_POLICY, ToolPermission } from '../../../src/types/tool-policy';
import type { ObsidianGeminiSettings } from '../../../src/types/settings';
import type { ObsidianGemini } from '../../../src/types/plugin';
import type { FeatureRoutes } from '../../../src/types/features';

function buildSettings(overrides: Partial<ObsidianGeminiSettings> = {}): ObsidianGeminiSettings {
	const features: FeatureRoutes = {
		chat: { provider: 'gemini', model: '' },
		summary: { provider: 'gemini', model: '' },
		completions: { provider: 'gemini', model: '' },
		rewrite: { provider: 'gemini', model: '' },
		webSearch: { provider: 'gemini', model: '' },
		deepResearch: { provider: 'gemini', model: '' },
		rag: { provider: 'gemini', model: '' },
		imageGen: { provider: 'gemini', model: '' },
	};
	return {
		defaultProvider: 'gemini',
		features,
		providerModelMemory: {},
		ollamaBaseUrl: 'http://localhost:11434',
		customBaseUrl: '',
		apiKeySecretName: '',
		openaiBaseUrl: 'https://api.openai.com/v1',
		openaiApiKeySecretName: '',
		anthropicApiKeySecretName: '',
		summaryFrontmatterKey: 'summary',
		userName: 'User',
		chatHistory: false,
		historyFolder: 'gemini-scribe',
		debugMode: false,
		fileLogging: false,
		stopOnToolError: true,
		toolPolicy: { ...DEFAULT_TOOL_POLICY },
		lastSeenVersion: '0.0.0',
		ragIndexing: {
			enabled: false,
			fileSearchStoreName: null,
			excludeFolders: [],
			autoSync: true,
			includeAttachments: false,
		},
		mcpServers: [],
		contextCompactionThreshold: 20,
		showTokenUsage: false,
		alwaysShowDiffView: false,
		logToolExecution: true,
		autoRunCatchUp: false,
		hooksEnabled: false,
		settingsSchemaVersion: 2,
		...overrides,
	};
}

/** A minimal plugin fixture with everything `src/ui/settings/**` reads or calls. */
export function buildPlugin(settingsOverrides: Partial<ObsidianGeminiSettings> = {}): ObsidianGemini {
	const settings = buildSettings(settingsOverrides);
	const geminiModels = [{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' as const }];

	const listProvider = { getModels: vi.fn(() => geminiModels), getTextModels: vi.fn(() => geminiModels) };
	const ollamaModelsService = { getModels: vi.fn(async () => []), invalidate: vi.fn() };
	const openaiModelsService = { getModels: vi.fn(async () => []), invalidate: vi.fn() };
	const anthropicModelsService = { getModels: vi.fn(async () => []), invalidate: vi.fn() };
	const modelManager = {
		getListProvider: vi.fn(() => listProvider),
		getOllamaModelsService: vi.fn(() => ollamaModelsService),
		getProviderModelsService: vi.fn((provider: string) =>
			provider === 'ollama' ? ollamaModelsService : provider === 'openai' ? openaiModelsService : anthropicModelsService
		),
		refreshRemoteModels: vi.fn(async () => ({ fetched: true, modelCount: geminiModels.length })),
	};
	const toolRegistry = {
		getEffectivePermission: vi.fn(() => ToolPermission.ASK_USER),
		getAllTools: vi.fn(() => []),
		getTool: vi.fn(() => undefined),
	};
	const mcpManager = {
		connectServer: vi.fn(async () => {}),
		disconnectServer: vi.fn(async () => {}),
		getServerStatus: vi.fn(() => 'disconnected'),
	};
	const ragIndexing = { getIndexedFileCount: vi.fn(() => 0), deleteFileSearchStore: vi.fn(async () => {}) };
	const scheduledTaskManager = { getTasks: vi.fn(() => []) };

	return {
		app: { vault: { configDir: '.obsidian', getMarkdownFiles: vi.fn(() => []) }, workspace: {} },
		settings,
		apiKey: settings.apiKeySecretName ? 'secret' : '',
		openaiApiKey: settings.openaiApiKeySecretName ? 'secret' : '',
		anthropicApiKey: settings.anthropicApiKeySecretName ? 'secret' : '',
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		saveSettings: vi.fn(async () => {}),
		getModelManager: vi.fn(() => modelManager),
		// The real plugin exposes both: `getModelManager()` and the `modelManager`
		// property resolve to the same instance (main.ts). Code under test reads
		// `plugin.modelManager` directly (e.g. provider-cards.ts), so the fixture
		// must mirror that rather than only the getter.
		modelManager,
		toolRegistry,
		mcpManager,
		ragIndexing,
		scheduledTaskManager,
	} as unknown as ObsidianGemini;
}

export function buildApp() {
	const secrets = new Map<string, string>();
	return {
		secretStorage: {
			getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				secrets.set(id, value);
			}),
			listSecrets: vi.fn(() => [...secrets.keys()]),
		},
	};
}
