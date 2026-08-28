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
		mockPlugin = { settings: { provider: 'gemini' } };
	});

	describe('registerAll', () => {
		it('should register tools from all core sources', async () => {
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'write_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'update_frontmatter' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'append_content' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'save_memory' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'activate_skill' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'recall_sessions' }));
		});

		it('should register the correct total number of tools', async () => {
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			// 4 vault + 1 web + 1 memory + 1 image + 1 skill + 1 session-recall = 9
			expect(mockRegistry.registerTool).toHaveBeenCalledTimes(9);
		});

		it('should skip Gemini-only sources when provider is ollama', async () => {
			mockPlugin.settings.provider = 'ollama';
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			// Web tools (google_search) and image tools (generate_image) should be skipped
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			// Vault, memory, skill, session-recall still register
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'save_memory' }));
		});

		// #704: the web/image tools call Google directly, so an override is all
		// they need — they aren't bound to whatever serves chat.
		it('registers web tools when webSearch is overridden to gemini under a local primary', async () => {
			mockPlugin.settings.provider = 'ollama';
			mockPlugin.settings.providerOverrides = { webSearch: 'gemini' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			// Image generation was not overridden, so it stays off.
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
		});

		it('registers image tools when imageGen is overridden to gemini under a local primary', async () => {
			mockPlugin.settings.provider = 'ollama';
			mockPlugin.settings.providerOverrides = { imageGen: 'gemini' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
		});

		it('skips cloud sources when an override points at a provider that cannot serve them', async () => {
			mockPlugin.settings.provider = 'gemini';
			mockPlugin.settings.providerOverrides = { webSearch: 'ollama', imageGen: 'ollama' };
			await registrar.registerAll(mockRegistry, mockLogger, mockPlugin);

			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
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
