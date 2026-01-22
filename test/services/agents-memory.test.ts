import { AgentsMemory, AgentsMemoryData } from '../../src/services/agents-memory';
import { TFile, normalizePath } from 'obsidian';

// Mock obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	normalizePath: jest.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	},
}));

// Mock Handlebars
jest.mock('handlebars', () => ({
	compile: jest.fn((template: string) => {
		return (data: any) => {
			// Simple template rendering for testing
			let result = template;
			Object.keys(data).forEach((key) => {
				const value = data[key];
				// Handle {{#if}} blocks
				const ifRegex = new RegExp(`{{#if ${key}}}([\\s\\S]*?){{/if}}`, 'g');
				result = result.replace(ifRegex, value ? '$1' : '');
				// Handle {{{value}}} (unescaped)
				result = result.replace(new RegExp(`{{{${key}}}}`, 'g'), value || '');
				// Handle {{value}} (escaped)
				result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
			});
			return result;
		};
	}),
}));

describe('AgentsMemory', () => {
	let agentsMemory: AgentsMemory;
	let mockPlugin: any;
	let mockVault: any;
	let mockAdapter: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: jest.fn(),
			read: jest.fn(),
			modify: jest.fn(),
			create: jest.fn(),
			adapter: {
				read: jest.fn(),
			},
		};

		mockAdapter = mockVault.adapter;

		// Setup mock plugin
		mockPlugin = {
			app: {
				vault: mockVault,
			},
			settings: {
				historyFolder: 'test-folder',
			},
			logger: {
				log: jest.fn(),
				debug: jest.fn(),
				warn: jest.fn(),
				error: jest.fn(),
				child: jest.fn(function (this: any, prefix: string) {
					return this;
				}),
			},
		};

		// Simple test template
		const testTemplate = `# AGENTS.md

{{#if vaultOverview}}{{{vaultOverview}}}{{/if}}
{{#if organization}}{{{organization}}}{{/if}}
{{#if keyTopics}}{{{keyTopics}}}{{/if}}
{{#if userPreferences}}{{{userPreferences}}}{{/if}}
{{#if customInstructions}}{{{customInstructions}}}{{/if}}`;

		agentsMemory = new AgentsMemory(mockPlugin, testTemplate);
	});

	describe('getMemoryFilePath', () => {
		it('should return correct path', () => {
			const path = agentsMemory.getMemoryFilePath();
			expect(path).toBe('test-folder/AGENTS.md');
		});
	});

	describe('exists', () => {
		it('should return true if file exists', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await agentsMemory.exists();

			expect(result).toBe(true);
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('test-folder/AGENTS.md');
		});

		it('should return false if file does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await agentsMemory.exists();

			expect(result).toBe(false);
		});

		it('should return false if path is not a TFile', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'some-folder' });

			const result = await agentsMemory.exists();

			expect(result).toBe(false);
		});
	});

	describe('read', () => {
		it('should read file content successfully', async () => {
			const mockFile = new TFile();
			mockFile.path = 'test-folder/AGENTS.md';
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('# AGENTS.md\nTest content');

			const result = await agentsMemory.read();

			expect(result).toBe('# AGENTS.md\nTest content');
			expect(mockVault.read).toHaveBeenCalledWith(mockFile);
		});

		it('should return null if file does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await agentsMemory.read();

			expect(result).toBeNull();
		});

		it('should return null if path is not a TFile', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'some-folder' });

			const result = await agentsMemory.read();

			expect(result).toBeNull();
		});

		it('should handle read errors gracefully', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockRejectedValue(new Error('Read error'));

			const result = await agentsMemory.read();

			expect(result).toBeNull();
		});
	});

	describe('write', () => {
		it('should modify existing file', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.modify.mockResolvedValue(undefined);

			await agentsMemory.write('New content');

			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, 'New content');
			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should create new file if it does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);

			await agentsMemory.write('New content');

			expect(mockVault.create).toHaveBeenCalledWith('test-folder/AGENTS.md', 'New content');
			expect(mockVault.modify).not.toHaveBeenCalled();
		});

		it('should throw error on write failure', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockRejectedValue(new Error('Write error'));

			await expect(agentsMemory.write('Content')).rejects.toThrow('Failed to write AGENTS.md: Write error');
		});
	});

	describe('append', () => {
		it('should append to existing file', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('Existing content');
			mockVault.modify.mockResolvedValue(undefined);

			await agentsMemory.append('New content');

			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, 'Existing content\n\nNew content');
		});

		it('should create new file with content if file does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);

			await agentsMemory.append('New content');

			expect(mockVault.create).toHaveBeenCalledWith('test-folder/AGENTS.md', 'New content');
		});

		it('should handle empty existing content', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('');
			mockVault.modify.mockResolvedValue(undefined);

			await agentsMemory.append('New content');

			// Empty string is falsy, so it creates a new file with just the content
			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, 'New content');
		});

		it('should trim existing content before appending', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('Existing content   \n\n');
			mockVault.modify.mockResolvedValue(undefined);

			await agentsMemory.append('New content');

			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, 'Existing content\n\nNew content');
		});

		it('should throw error on append failure', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('Content');
			mockVault.modify.mockRejectedValue(new Error('Modify error'));

			// The error message includes both the append error and the nested write error
			await expect(agentsMemory.append('New')).rejects.toThrow('Failed to append to AGENTS.md');
		});
	});

	describe('render', () => {
		it('should render template with data', () => {
			const data: AgentsMemoryData = {
				vaultOverview: 'Test vault overview',
			};

			const result = agentsMemory.render(data);

			expect(result).toContain('Test vault overview');
		});

		it('should render template with multiple fields', () => {
			const data: AgentsMemoryData = {
				vaultOverview: 'Overview',
				keyTopics: 'Topics',
			};

			const result = agentsMemory.render(data);

			expect(result).toContain('Overview');
			expect(result).toContain('Topics');
		});

		it('should handle empty data', () => {
			const result = agentsMemory.render({});

			expect(result).not.toContain('undefined');
		});
	});

	describe('initialize', () => {
		it('should not create file if it already exists', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

			await agentsMemory.initialize();

			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should create file with default template if it does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);
			mockAdapter.read.mockResolvedValue('# AGENTS.md\nDefault template');

			await agentsMemory.initialize();

			expect(mockVault.create).toHaveBeenCalled();
			const createCall = mockVault.create.mock.calls[0];
			expect(createCall[0]).toBe('test-folder/AGENTS.md');
			expect(createCall[1]).toBeTruthy();
		});

		it('should create file with provided data', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);
			mockAdapter.read.mockResolvedValue('{{#if vaultOverview}}{{{vaultOverview}}}{{/if}}');

			const data: AgentsMemoryData = {
				vaultOverview: 'Custom overview',
			};

			await agentsMemory.initialize(data);

			expect(mockVault.create).toHaveBeenCalled();
			const createCall = mockVault.create.mock.calls[0];
			expect(createCall[1]).toContain('Custom overview');
		});
	});
});
