import { PromptManager } from '../../src/prompts/prompt-manager';
import { Vault, TFile, TFolder as MockTFolder } from 'obsidian';
import type ObsidianGemini from '../../src/main';

// Mock obsidian module
vi.mock('obsidian', () => {
	const TFile = vi.fn();
	const TFolder = vi.fn();

	// Mock SuggestModal base class
	class MockSuggestModal {
		constructor(_app: any) {}
		setPlaceholder(_placeholder: string) {}
		open() {}
	}

	// Mock Modal base class
	class MockModal {
		constructor(_app: any) {}
		open() {}
		close() {}
		onOpen() {}
		onClose() {}
		contentEl = {
			empty: vi.fn(),
			createEl: vi.fn(function () {
				return {
					style: {},
					addEventListener: vi.fn(),
					createEl: vi.fn(() => ({
						style: {},
						addEventListener: vi.fn(),
					})),
					createDiv: vi.fn(() => ({
						style: {},
						createEl: vi.fn(() => ({
							style: {},
							addEventListener: vi.fn(),
						})),
					})),
				};
			}),
			createDiv: vi.fn(function () {
				return {
					style: {},
					createEl: vi.fn(() => ({
						style: {},
						addEventListener: vi.fn(),
					})),
				};
			}),
		};
	}

	return {
		Vault: vi.fn(),
		TFile: TFile,
		TFolder: TFolder,
		normalizePath: vi.fn((path: string) => path),
		Notice: vi.fn(),
		SuggestModal: MockSuggestModal,
		Modal: MockModal,
		App: vi.fn(),
	};
});

describe('PromptManager', () => {
	let promptManager: PromptManager;
	let mockPlugin: any;
	let mockVault: any;

	beforeEach(() => {
		// Setup mocks
		mockPlugin = {
			settings: {
				historyFolder: 'gemini-scribe',
			},
			app: {
				metadataCache: {
					getFileCache: vi.fn(),
					getFirstLinkpathDest: vi.fn(),
				},
			},
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(function (this: any, _prefix: string) {
					return this;
				}),
			},
		};

		mockVault = {
			adapter: {
				exists: vi.fn(),
				list: vi.fn(),
			},
			createFolder: vi.fn(() => Promise.resolve()),
			getAbstractFileByPath: vi.fn(),
			read: vi.fn(),
			create: vi.fn(),
			getMarkdownFiles: vi.fn(() => []),
		};

		promptManager = new PromptManager(mockPlugin as ObsidianGemini, mockVault as Vault);
	});

	describe('getPromptsDirectory', () => {
		it('should return correct prompts directory path', () => {
			mockPlugin.settings.historyFolder = 'gemini-scribe';
			expect(promptManager.getPromptsDirectory()).toBe('gemini-scribe/Prompts');
		});

		it('should handle different history folder names', () => {
			mockPlugin.settings.historyFolder = 'ai-history';
			expect(promptManager.getPromptsDirectory()).toBe('ai-history/Prompts');
		});
	});

	describe('loadPromptFromFile', () => {
		it('should load and parse valid prompt file', async () => {
			const mockFile = new TFile();
			const frontmatterContent = `---
name: "Test Prompt"
description: "Test description"
version: 1
override_system_prompt: false
tags: [test]
---`;
			const mockContent = `${frontmatterContent}
Test prompt content`;
			const mockCache = {
				frontmatter: {
					name: 'Test Prompt',
					description: 'Test description',
					version: 1,
					override_system_prompt: false,
					tags: ['test'],
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 6, col: 3, offset: frontmatterContent.length },
				},
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockContent);

			const result = await promptManager.loadPromptFromFile('test.md');

			expect(result).toEqual({
				name: 'Test Prompt',
				description: 'Test description',
				version: 1,
				overrideSystemPrompt: false,
				tags: ['test'],
				content: 'Test prompt content',
			});
		});

		it('should handle missing frontmatter gracefully', async () => {
			const mockContent = 'Just prompt content without frontmatter';
			const mockFile = new TFile();
			const mockCache = {}; // No frontmatter

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockContent);

			const result = await promptManager.loadPromptFromFile('test.md');

			expect(result?.name).toBe('Unnamed Prompt');
			expect(result?.content).toBe(mockContent);
		});

		it('should return null for non-existent files', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await promptManager.loadPromptFromFile('nonexistent.md');

			expect(result).toBeNull();
		});

		it('should handle read errors gracefully', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockRejectedValue(new Error('Read error'));

			const result = await promptManager.loadPromptFromFile('error.md');

			expect(result).toBeNull();
		});
	});

	describe('listAvailablePrompts', () => {
		it('should list all markdown files in prompts directory', async () => {
			// Mock the prompts folder
			const mockFolder = Object.create(MockTFolder.prototype);
			mockFolder.path = 'gemini-scribe/Prompts';

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Prompts') return mockFolder;
				return Object.assign({}, { path });
			});

			// Mock markdown files
			const mockFile1 = Object.assign(new TFile(), { path: 'gemini-scribe/Prompts/prompt1.md', basename: 'prompt1' });
			const mockFile2 = Object.assign(new TFile(), { path: 'gemini-scribe/Prompts/prompt2.md', basename: 'prompt2' });

			mockVault.getMarkdownFiles.mockReturnValue([
				mockFile1,
				mockFile2,
				Object.assign(new TFile(), { path: 'other-folder/file.md' }), // Should be filtered out
			]);

			// Reset and set up mocks for getAbstractFileByPath for file loading
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Prompts') return mockFolder;
				if (path.includes('prompt1.md') || path.includes('prompt2.md')) {
					return Object.assign(new TFile(), { path });
				}
				return null;
			});

			const mockCache = {
				frontmatter: {
					name: 'Test Prompt',
					description: 'Test',
					tags: ['test'],
				},
				sections: [
					{ type: 'yaml', position: { start: { line: 0 }, end: { line: 4 } } },
					{ type: 'paragraph', position: { start: { line: 5 }, end: { line: 5 } } },
				],
			};
			const mockPromptContent = `---
name: "Test Prompt"
description: "Test"
tags: [test]
---
Content`;

			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockPromptContent);

			const result = await promptManager.listAvailablePrompts();

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				path: 'gemini-scribe/Prompts/prompt1.md',
				name: 'Test Prompt',
				description: 'Test',
				tags: ['test'],
			});
		});

		it('should handle empty prompts directory', async () => {
			mockVault.adapter.list.mockResolvedValue({
				files: [],
				folders: [],
			});

			const result = await promptManager.listAvailablePrompts();

			expect(result).toEqual([]);
		});
	});

	describe('createDefaultPrompts', () => {
		it('should create example prompt if it does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			await promptManager.createDefaultPrompts();

			expect(mockVault.create).toHaveBeenCalledWith(
				'gemini-scribe/Prompts/example-expert.md',
				expect.stringContaining('Subject Matter Expert')
			);
		});

		it('should not create example prompt if it already exists', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

			await promptManager.createDefaultPrompts();

			expect(mockVault.create).not.toHaveBeenCalled();
		});
	});

	describe('frontmatter parsing via Obsidian API', () => {
		it('should parse complex YAML frontmatter correctly', async () => {
			const frontmatterContent = `---
name: "Complex Prompt"
description: "A prompt with various YAML features"
version: 2
override_system_prompt: true
tags: [ai, assistant, complex]
---`;
			const mockContent = `${frontmatterContent}
This is the prompt content`;
			const mockCache = {
				frontmatter: {
					name: 'Complex Prompt',
					description: 'A prompt with various YAML features',
					version: 2,
					override_system_prompt: true,
					tags: ['ai', 'assistant', 'complex'],
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 6, col: 3, offset: frontmatterContent.length },
				},
			};

			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockContent);

			const result = await promptManager.loadPromptFromFile('complex.md');

			expect(result).toEqual({
				name: 'Complex Prompt',
				description: 'A prompt with various YAML features',
				version: 2,
				overrideSystemPrompt: true,
				tags: ['ai', 'assistant', 'complex'],
				content: 'This is the prompt content',
			});
		});

		it('should handle quoted strings in YAML', async () => {
			const mockCache = {
				frontmatter: {
					name: "Prompt with 'quotes'",
					description: 'Another "quoted" string',
				},
			};
			const mockContent = `---
name: "Prompt with 'quotes'"
description: 'Another "quoted" string'
---
Content`;

			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockContent);

			const result = await promptManager.loadPromptFromFile('quoted.md');

			expect(result?.name).toBe("Prompt with 'quotes'");
			expect(result?.description).toBe('Another "quoted" string');
		});
	});
});
