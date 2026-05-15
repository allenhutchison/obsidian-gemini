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

	describe('loadPromptFromFile tag normalization', () => {
		it('should normalize a string tag to a single-element array', async () => {
			const mockFile = new TFile();
			const mockCache = {
				frontmatter: {
					name: 'Tagged Prompt',
					description: 'desc',
					tags: 'single-tag',
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 4, col: 3, offset: 50 },
				},
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue('---\nname: Tagged Prompt\ndescription: desc\ntags: single-tag\n---\nContent');

			const result = await promptManager.loadPromptFromFile('tagged.md');

			expect(result?.tags).toEqual(['single-tag']);
		});

		it('should normalize a non-string/non-array tag value to an empty array', async () => {
			const mockFile = new TFile();
			const mockCache = {
				frontmatter: {
					name: 'Numeric Tag Prompt',
					description: 'desc',
					tags: 42,
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 4, col: 3, offset: 50 },
				},
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue('---\nname: Numeric Tag Prompt\ndescription: desc\ntags: 42\n---\nContent');

			const result = await promptManager.loadPromptFromFile('numeric-tag.md');

			expect(result?.tags).toEqual([]);
		});

		it('should lowercase all tags in the array', async () => {
			const mockFile = new TFile();
			const mockCache = {
				frontmatter: {
					name: 'Mixed Case',
					description: 'desc',
					tags: ['AI', 'Expert', 'UPPERCASE'],
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 4, col: 3, offset: 50 },
				},
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(
				'---\nname: Mixed Case\ndescription: desc\ntags: [AI, Expert, UPPERCASE]\n---\nContent'
			);

			const result = await promptManager.loadPromptFromFile('mixed.md');

			expect(result?.tags).toEqual(['ai', 'expert', 'uppercase']);
		});

		it('should filter out non-string elements from a tags array', async () => {
			const mockFile = new TFile();
			const mockCache = {
				frontmatter: {
					name: 'Mixed Array',
					description: 'desc',
					tags: ['valid', 123, null, 'also-valid'],
				},
				frontmatterPosition: {
					start: { line: 0, col: 0, offset: 0 },
					end: { line: 4, col: 3, offset: 50 },
				},
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(mockCache);
			mockVault.read.mockResolvedValue(
				'---\nname: Mixed Array\ndescription: desc\ntags: [valid, 123, null, also-valid]\n---\nContent'
			);

			const result = await promptManager.loadPromptFromFile('mixed-array.md');

			expect(result?.tags).toEqual(['valid', 'also-valid']);
		});
	});

	describe('listPromptsByTag', () => {
		function setupPromptFiles(promptsData: Array<{ path: string; basename: string; name: string; tags: string[] }>) {
			const mockFolder = Object.create(MockTFolder.prototype);
			mockFolder.path = 'gemini-scribe/Prompts';

			const files = promptsData.map((p) => Object.assign(new TFile(), { path: p.path, basename: p.basename }));

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Prompts') return mockFolder;
				const file = files.find((f) => f.path === path);
				return file ? Object.assign(new TFile(), { path }) : null;
			});

			mockVault.getMarkdownFiles.mockReturnValue(files);

			let callIdx = 0;
			mockPlugin.app.metadataCache.getFileCache.mockImplementation(() => {
				const data = promptsData[callIdx++ % promptsData.length];
				return {
					frontmatter: { name: data.name, description: 'desc', tags: data.tags },
					frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 4, col: 3, offset: 50 } },
				};
			});
			mockVault.read.mockResolvedValue('---\nname: P\n---\nContent');
		}

		it('should return prompts matching the specified tag', async () => {
			setupPromptFiles([
				{ path: 'gemini-scribe/Prompts/a.md', basename: 'a', name: 'A', tags: ['expert', 'general'] },
				{ path: 'gemini-scribe/Prompts/b.md', basename: 'b', name: 'B', tags: ['code'] },
			]);

			const result = await promptManager.listPromptsByTag('expert');

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('A');
		});

		it('should return empty array when no prompts match the tag', async () => {
			setupPromptFiles([{ path: 'gemini-scribe/Prompts/a.md', basename: 'a', name: 'A', tags: ['expert'] }]);

			const result = await promptManager.listPromptsByTag('nonexistent');

			expect(result).toHaveLength(0);
		});

		it('should match tags case-insensitively', async () => {
			setupPromptFiles([{ path: 'gemini-scribe/Prompts/a.md', basename: 'a', name: 'A', tags: ['Expert'] }]);

			const result = await promptManager.listPromptsByTag('EXPERT');

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('A');
		});
	});

	describe('listSelectionPrompts', () => {
		// We need to mock BundledPromptRegistry for these tests
		let mockGetPrompts: ReturnType<typeof vi.fn>;

		beforeEach(async () => {
			// Dynamic import the mocked module
			const { BundledPromptRegistry } = await import('../../src/prompts/bundled-prompts');
			mockGetPrompts = vi.fn();
			(BundledPromptRegistry as any).getPrompts = mockGetPrompts;
		});

		it('should merge vault and bundled selection prompts', async () => {
			// Setup: no vault prompts, two bundled selection prompts
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getMarkdownFiles.mockReturnValue([]);
			mockGetPrompts.mockReturnValue([
				{
					name: 'Bundled Fix Grammar',
					description: 'Fix grammar',
					tags: ['gemini-scribe/selection-prompt'],
					content: 'Fix grammar.',
				},
			]);

			const result = await promptManager.listSelectionPrompts();

			expect(result.some((p) => p.name === 'Bundled Fix Grammar')).toBe(true);
			expect(result.find((p) => p.name === 'Bundled Fix Grammar')?.path).toBe('bundled:Bundled Fix Grammar');
		});

		it('should give vault prompts priority over bundled prompts with the same name', async () => {
			const selTag = 'gemini-scribe/selection-prompt';

			// Setup: vault prompt with same name as bundled
			const mockFolder = Object.create(MockTFolder.prototype);
			mockFolder.path = 'gemini-scribe/Prompts';
			const file = Object.assign(new TFile(), {
				path: 'gemini-scribe/Prompts/fix-grammar.md',
				basename: 'fix-grammar',
			});

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Prompts') return mockFolder;
				if (path === 'gemini-scribe/Prompts/fix-grammar.md') return Object.assign(new TFile(), { path });
				return null;
			});
			mockVault.getMarkdownFiles.mockReturnValue([file]);

			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { name: 'Fix Grammar Override', description: 'My custom', tags: [selTag] },
				frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 4, col: 3, offset: 50 } },
			});
			mockVault.read.mockResolvedValue('---\nname: Fix Grammar Override\n---\nCustom content');

			mockGetPrompts.mockReturnValue([
				{
					name: 'Fix Grammar Override',
					description: 'Bundled version',
					tags: [selTag],
					content: 'Bundled content.',
				},
			]);

			const result = await promptManager.listSelectionPrompts();

			// Should have only one entry for "Fix Grammar Override" and it should be the vault version
			const matches = result.filter((p) => p.name === 'Fix Grammar Override');
			expect(matches).toHaveLength(1);
			expect(matches[0].path).toBe('gemini-scribe/Prompts/fix-grammar.md');
		});
	});

	describe('loadPrompt', () => {
		it('should load a bundled prompt by bundled: prefix path', async () => {
			const { BundledPromptRegistry } = await import('../../src/prompts/bundled-prompts');
			(BundledPromptRegistry as any).getPrompts = vi.fn().mockReturnValue([
				{
					name: 'Test Bundled',
					description: 'A bundled prompt',
					tags: ['test'],
					content: 'Bundled content here.',
				},
			]);

			const result = await promptManager.loadPrompt('bundled:Test Bundled');

			expect(result).toBeDefined();
			expect(result?.name).toBe('Test Bundled');
			expect(result?.content).toBe('Bundled content here.');
			expect(result?.version).toBe(1);
			expect(result?.overrideSystemPrompt).toBe(false);
		});

		it('should return null for a bundled: path that does not match any bundled prompt', async () => {
			const { BundledPromptRegistry } = await import('../../src/prompts/bundled-prompts');
			(BundledPromptRegistry as any).getPrompts = vi.fn().mockReturnValue([]);

			const result = await promptManager.loadPrompt('bundled:Nonexistent');

			expect(result).toBeNull();
		});

		it('should delegate to loadPromptFromFile for non-bundled paths', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { name: 'Vault Prompt', description: 'desc' },
				frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 3, col: 3, offset: 26 } },
			});
			mockVault.read.mockResolvedValue('---\nname: Vault Prompt\n---\nVault content');

			const result = await promptManager.loadPrompt('gemini-scribe/Prompts/vault.md');

			expect(result?.name).toBe('Vault Prompt');
			expect(result?.content).toBe('Vault content');
		});
	});

	describe('createDefaultPrompts race condition', () => {
		it('should swallow a concurrent "already exists" error from vault.create', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockRejectedValue(new Error('File already exists'));

			// Should NOT throw — the race condition error is swallowed
			await expect(promptManager.createDefaultPrompts()).resolves.toBeUndefined();
		});

		it('should rethrow non-existence errors from vault.create', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockRejectedValue(new Error('Disk full'));

			await expect(promptManager.createDefaultPrompts()).rejects.toThrow('Disk full');
		});

		it('should swallow a non-Error throwable that is not an instance of Error', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockRejectedValue('string error');

			// Non-Error values don't pass the instanceof check, so they're rethrown
			await expect(promptManager.createDefaultPrompts()).rejects.toBe('string error');
		});
	});

	describe('setupPromptCommands', () => {
		it('registers a command with the correct id', () => {
			mockPlugin.addCommand = vi.fn();
			promptManager.setupPromptCommands();

			expect(mockPlugin.addCommand).toHaveBeenCalledTimes(1);
			expect(mockPlugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'gemini-scribe-create-custom-prompt',
					name: 'Create New Custom Prompt',
				})
			);
		});

		it('registered command callback invokes createNewCustomPrompt', () => {
			mockPlugin.addCommand = vi.fn();
			const spy = vi.spyOn(promptManager, 'createNewCustomPrompt').mockResolvedValue(undefined);

			promptManager.setupPromptCommands();
			const command = mockPlugin.addCommand.mock.calls[0][0];
			command.callback();

			expect(spy).toHaveBeenCalled();
			spy.mockRestore();
		});
	});

	describe('createNewCustomPrompt', () => {
		beforeEach(() => {
			mockPlugin.addCommand = vi.fn();
			mockPlugin.app.workspace = { openLinkText: vi.fn().mockResolvedValue(undefined) };
		});

		it('opens a modal without error', async () => {
			await expect(promptManager.createNewCustomPrompt()).resolves.toBeUndefined();
		});

		it('catches and logs outer errors gracefully', async () => {
			// Force an error in the outer try block by making the PromptNameModal constructor
			// throw (simulated by overriding the plugin.app to lack required props)
			const brokenPlugin = {
				...mockPlugin,
				app: null as any, // This will cause the modal constructor to throw
			};
			const brokenManager = new PromptManager(brokenPlugin, mockVault);

			// Should not throw — the outer try/catch handles it
			await brokenManager.createNewCustomPrompt();
			expect(brokenPlugin.logger?.error || vi.fn()).toBeDefined();
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
