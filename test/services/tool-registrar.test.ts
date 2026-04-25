import { ToolRegistrar } from '../../src/services/tool-registrar';

// Mock all tool source modules
vi.mock('../../src/tools/vault', () => ({
	getVaultTools: () => [{ name: 'read_file' }, { name: 'write_file' }],
}));

vi.mock('../../src/tools/vault-tools-extended', () => ({
	getExtendedVaultTools: () => [{ name: 'read_frontmatter' }],
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
	});

	describe('registerAll', () => {
		it('should register tools from all core sources', async () => {
			await registrar.registerAll(mockRegistry, mockLogger);

			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'write_file' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_frontmatter' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'google_search' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'save_memory' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'generate_image' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'activate_skill' }));
			expect(mockRegistry.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'recall_sessions' }));
		});

		it('should register the correct total number of tools', async () => {
			await registrar.registerAll(mockRegistry, mockLogger);

			// 2 vault + 1 extended + 1 web + 1 memory + 1 image + 1 skill + 1 session-recall = 8
			expect(mockRegistry.registerTool).toHaveBeenCalledTimes(8);
		});

		it('should continue registering other sources if one fails', async () => {
			// Make registerTool throw for a specific tool
			mockRegistry.registerTool.mockImplementation((tool: any) => {
				if (tool.name === 'read_frontmatter') {
					throw new Error('Registration failed');
				}
			});

			await registrar.registerAll(mockRegistry, mockLogger);

			// Should log the error for the vault-extended source
			expect(mockLogger.error).toHaveBeenCalledWith('Failed to register vault-extended tools:', expect.any(Error));
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
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('read_frontmatter');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('google_search');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('save_memory');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('generate_image');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('activate_skill');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('recall_sessions');
		});

		it('should continue unregistering other sources if one fails', async () => {
			mockRegistry.unregisterTool.mockImplementation((name: string) => {
				if (name === 'read_frontmatter') {
					throw new Error('Unregistration failed');
				}
			});

			await registrar.unregisterAll(mockRegistry, mockLogger);

			// Should log debug for the vault-extended source failure
			expect(mockLogger.debug).toHaveBeenCalledWith('Failed to unregister vault-extended tools:', expect.any(Error));
			// Should still have unregistered tools from other sources
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('read_file');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('google_search');
			expect(mockRegistry.unregisterTool).toHaveBeenCalledWith('activate_skill');
		});
	});
});
