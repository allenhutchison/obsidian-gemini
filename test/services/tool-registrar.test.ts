import { ToolRegistrar } from '../../src/services/tool-registrar';

// Mock all tool source modules
vi.mock('../../src/tools/vault', () => ({
	getVaultTools: () => [
		{ name: 'read_file' },
		{ name: 'write_file' },
		{ name: 'update_frontmatter' },
		{ name: 'append_content' },
	],
}));

vi.mock('../../src/tools/web-tools', () => ({
	getWebTools: () => [{ name: 'google_search' }],
	getMapsTools: () => [{ name: 'google_maps' }],
	getDeepResearchTools: () => [{ name: 'deep_research' }],
}));

vi.mock('../../src/tools/memory-tool', () => ({
	getMemoryTools: () => [{ name: 'save_memory' }],
}));

vi.mock('../../src/tools/image-tools', () => ({
	getImageTools: () => [{ name: 'generate_image' }],
}));

vi.mock('../../src/tools/skill-tools', () => ({
	getSkillTools: () => [{ name: 'activate_skill' }],
}));

vi.mock('../../src/tools/session-recall-tool', () => ({
	getSessionRecallTools: () => [{ name: 'recall_sessions' }],
}));

/** A fully-routed features table with every feature on the given provider. */
function featuresAllOn(provider: string) {
	return {
		chat: { provider, model: '' },
		summary: { provider, model: '' },
		completions: { provider, model: '' },
		rewrite: { provider, model: '' },
		webSearch: { provider, model: '' },
		deepResearch: { provider, model: '' },
		rag: { provider, model: '' },
		imageGen: { provider, model: '' },
	};
}

describe('ToolRegistrar', () => {
	let registrar: ToolRegistrar;
	let mockRegistry: any;
	let mockLogger: any;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		registrar = new ToolRegistrar();
		mockRegistry = {
			registerTool: vi.fn(),
			unregisterTool: vi.fn(),
		};
		mockLogger = {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		};
		mockPlugin = {
			settings: {
				defaultProvider: 'gemini',
				apiKeySecretName: 'gemini-key',
				features: featuresAllOn('gemini'),
			},
		};
	});

	describe('registerAll', () => {
		it('should register tools from all core sources', async () => {
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'write_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'update_frontmatter' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'append_content' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_maps' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'deep_research' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'save_memory' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'activate_skill' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'recall_sessions' }));
		});

		it('should register the correct total number of tools', async () => {
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			// 4 vault + 1 web + 1 maps + 1 deep-research + 1 memory + 1 image + 1 skill + 1 session-recall = 11
			expect(mockRegistry.registerTool).toHaveBeenCalledTimes(11);
		});

		it('should skip Gemini-only sources when nothing routes to Gemini and no Gemini key is configured', async () => {
			mockPlugin.settings.apiKeySecretName = '';
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			// webSearch/deepResearch/imageGen aren't supported by ollama -> gated off.
			// Maps is provider-bound on Gemini being configured -> also off (no key).
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_maps' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'deep_research' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			// Vault, memory, skill, session-recall still register
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'save_memory' }));
		});

		// The web/image tools call Google directly, so routing the feature to
		// gemini is all they need — they aren't bound to whatever serves chat.
		it('registers web tools when webSearch is routed to gemini under a local default provider', async () => {
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			mockPlugin.settings.features.webSearch = { provider: 'gemini', model: '' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			// Image generation was not routed to gemini, so it stays off.
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
		});

		it('registers image tools when imageGen is routed to gemini under a local default provider', async () => {
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			mockPlugin.settings.features.imageGen = { provider: 'gemini', model: '' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
		});

		it('skips cloud sources when routed to a provider that cannot serve them', async () => {
			mockPlugin.settings.defaultProvider = 'gemini';
			mockPlugin.settings.features = featuresAllOn('gemini');
			mockPlugin.settings.features.webSearch = { provider: 'ollama', model: '' };
			mockPlugin.settings.features.imageGen = { provider: 'ollama', model: '' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
		});

		it('registers maps regardless of webSearch routing, as long as Gemini is configured', async () => {
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			// webSearch stays off Gemini, but the Gemini card still has a key.
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_maps' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
		});

		it('skips maps when the Gemini provider has no key configured', async () => {
			mockPlugin.settings.apiKeySecretName = '';
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_maps' }));
		});

		// A route can say 'gemini' with no key actually configured (e.g. a
		// stale/hand-edited settings file) — the route alone isn't enough,
		// same as maps above.
		it('skips web search when routed to gemini but no Gemini key is configured', async () => {
			mockPlugin.settings.apiKeySecretName = '';
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			mockPlugin.settings.features.webSearch = { provider: 'gemini', model: '' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
		});

		it('skips deep research when routed to gemini but no Gemini key is configured', async () => {
			mockPlugin.settings.apiKeySecretName = '';
			mockPlugin.settings.defaultProvider = 'ollama';
			mockPlugin.settings.features = featuresAllOn('ollama');
			mockPlugin.settings.features.deepResearch = { provider: 'gemini', model: '' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'deep_research' }));
		});

		it('should continue registering other sources if one fails', async () => {
			// Make registerTool throw for a specific tool
			mockRegistry.registerTool.mockImplementation((tool: any) => {
				if (tool.name === 'write_file') {
					throw new Error('Registration failed');
				}
			});

			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			// Should log the error for the vault source
			expect(mockLogger.error).toHaveBeenCalledWith('Failed to register vault tools:', expect.any(Error));
			// Should still have registered tools from other sources
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'activate_skill' }));
		});
	});

	describe('unregisterAll', () => {
		it('should unregister tools from all core sources', async () => {
			await registrar.unregisterAll(mockRegistry, mockLogger);

			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('read_file');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('write_file');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('update_frontmatter');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('append_content');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('google_search');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('google_maps');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('deep_research');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('save_memory');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('generate_image');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('activate_skill');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('recall_sessions');
		});

		it('should continue unregistering other sources if one fails', async () => {
			mockRegistry.unregisterTool.mockImplementation((name: string) => {
				if (name === 'write_file') {
					throw new Error('Unregistration failed');
				}
			});

			await registrar.unregisterAll(mockRegistry, mockLogger);

			// Should log debug for the vault source failure
			expect(mockLogger.debug).toHaveBeenCalledWith('Failed to unregister vault tools:', expect.any(Error));
			// Should still have unregistered tools from other sources
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('read_file');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('google_search');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('activate_skill');
		});
	});
});
