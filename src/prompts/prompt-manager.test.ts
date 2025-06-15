import { PromptManager } from './prompt-manager';
import { Vault, TFile } from 'obsidian';
import ObsidianGemini from '../../main';

// Mock obsidian module
jest.mock('obsidian', () => {
	const TFile = jest.fn();
	return {
		Vault: jest.fn(),
		TFile: TFile,
		normalizePath: jest.fn((path: string) => path)
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
				historyFolder: 'gemini-scribe'
			},
			app: {
				metadataCache: {
					getFileCache: jest.fn(),
					getFirstLinkpathDest: jest.fn()
				}
			}
		};

		mockVault = {
			adapter: {
				exists: jest.fn(),
				list: jest.fn()
			},
			createFolder: jest.fn(),
			getAbstractFileByPath: jest.fn(),
			read: jest.fn(),
			create: jest.fn()
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

	describe('ensurePromptsDirectory', () => {
		it('should create directory if it does not exist', async () => {
			mockVault.adapter.exists.mockResolvedValue(false);
			
			await promptManager.ensurePromptsDirectory();
			
			expect(mockVault.createFolder).toHaveBeenCalledWith('gemini-scribe/Prompts');
		});

		it('should not create directory if it exists', async () => {
			mockVault.adapter.exists.mockResolvedValue(true);
			
			await promptManager.ensurePromptsDirectory();
			
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});
	});

	describe('loadPromptFromFile', () => {
		it('should load and parse valid prompt file', async () => {
			const mockFile = new TFile();
			const mockCache = {
				frontmatter: {
					name: 'Test Prompt',
					description: 'Test description',
					version: 1,
					override_system_prompt: false,
					tags: ['test']
				}
			};
			const mockContent = `---
name: "Test Prompt"
description: "Test description"
version: 1
override_system_prompt: false
tags: [test]
---
Test prompt content`;
			
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
				content: 'Test prompt content'
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

	describe('getPromptFromNote', () => {
		const mockFile = {} as TFile;

		it('should extract prompt from frontmatter wikilink', async () => {
			const mockCache = {
				frontmatter: {
					'gemini-scribe-prompt': '[[Prompts/test-prompt.md]]'
				}
			};
			
			const mockPromptFile = new TFile();
			const mockPromptCache = {
				frontmatter: {
					name: 'Test'
				}
			};
			
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockPromptFile);
			mockVault.getAbstractFileByPath.mockReturnValue(mockPromptFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValueOnce(mockCache).mockReturnValueOnce(mockPromptCache);
			mockVault.read.mockResolvedValue('---\nname: "Test"\n---\nContent');
			
			const result = await promptManager.getPromptFromNote(mockFile);
			
			expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('Prompts/test-prompt.md', undefined);
			expect(result?.name).toBe('Test');
		});

		it('should return null when no prompt specified', async () => {
			const mockCache = { frontmatter: {} };
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			
			const result = await promptManager.getPromptFromNote(mockFile);
			
			expect(result).toBeNull();
		});

		it('should handle invalid wikilink format', async () => {
			const mockCache = {
				frontmatter: {
					'gemini-scribe-prompt': 'not-a-wikilink'
				}
			};
			
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			
			const result = await promptManager.getPromptFromNote(mockFile);
			
			expect(result).toBeNull();
		});

		it('should handle missing cache', async () => {
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);
			
			const result = await promptManager.getPromptFromNote(mockFile);
			
			expect(result).toBeNull();
		});
	});

	describe('listAvailablePrompts', () => {
		it('should list all markdown files in prompts directory', async () => {
			// Mock list returns files array directly in this implementation
			mockVault.adapter.list.mockImplementation(async () => ({
				files: [
					'gemini-scribe/Prompts/prompt1.md',
					'gemini-scribe/Prompts/prompt2.md',
					'gemini-scribe/Prompts/README.txt' // Should be ignored
				],
				folders: []
			}));

			const mockCache = {
				frontmatter: {
					name: 'Test Prompt',
					description: 'Test',
					tags: ['test']
				}
			};
			const mockPromptContent = `---
name: "Test Prompt"
description: "Test"
tags: [test]
---
Content`;

			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(mockPromptContent);

			const result = await promptManager.listAvailablePrompts();
			
			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				path: 'gemini-scribe/Prompts/prompt1.md',
				name: 'Test Prompt',
				description: 'Test',
				tags: ['test']
			});
		});

		it('should handle empty prompts directory', async () => {
			mockVault.adapter.list.mockResolvedValue({
				files: [],
				folders: []
			});

			const result = await promptManager.listAvailablePrompts();
			
			expect(result).toEqual([]);
		});
	});

	describe('createDefaultPrompts', () => {
		it('should create example prompt if it does not exist', async () => {
			mockVault.adapter.exists.mockResolvedValue(false);
			
			await promptManager.createDefaultPrompts();
			
			expect(mockVault.create).toHaveBeenCalledWith(
				'gemini-scribe/Prompts/example-expert.md',
				expect.stringContaining('Subject Matter Expert')
			);
		});

		it('should not create example prompt if it already exists', async () => {
			mockVault.adapter.exists.mockResolvedValue(true);
			
			await promptManager.createDefaultPrompts();
			
			expect(mockVault.create).not.toHaveBeenCalled();
		});
	});

	describe('frontmatter parsing via Obsidian API', () => {
		it('should parse complex YAML frontmatter correctly', async () => {
			const mockCache = {
				frontmatter: {
					name: 'Complex Prompt',
					description: 'A prompt with various YAML features',
					version: 2,
					override_system_prompt: true,
					tags: ['ai', 'assistant', 'complex']
				}
			};
			const mockContent = `---
name: "Complex Prompt"
description: "A prompt with various YAML features"
version: 2
override_system_prompt: true
tags: [ai, assistant, complex]
---
This is the prompt content`;

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
				content: 'This is the prompt content'
			});
		});

		it('should handle quoted strings in YAML', async () => {
			const mockCache = {
				frontmatter: {
					name: "Prompt with 'quotes'",
					description: 'Another "quoted" string'
				}
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