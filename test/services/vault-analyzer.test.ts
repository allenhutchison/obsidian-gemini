// Mock obsidian module
vi.mock('obsidian', () => {
	class MockTFile {
		path: string;
		basename: string;
		extension: string;
		parent: { path: string } | null;
		stat: { mtime: number };
		constructor(path: string = 'test.md', mtime: number = 0) {
			this.path = path;
			this.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
			this.extension = 'md';
			this.parent = path.includes('/') ? { path: path.substring(0, path.lastIndexOf('/')) } : null;
			this.stat = { mtime };
		}
	}

	class MockTFolder {
		path: string;
		name: string;
		children: any[];
		constructor(path: string = '', name?: string) {
			this.path = path;
			this.name = name ?? (path === '' ? '' : path.split('/').pop()!);
			this.children = [];
		}
	}

	return {
		TFile: MockTFile,
		TFolder: MockTFolder,
		Notice: vi.fn(),
		normalizePath: (p: string) => p,
	};
});

// Mock ModelClientFactory
vi.mock('../../src/api', () => ({
	ModelClientFactory: {
		createChatModel: vi.fn().mockReturnValue({
			generateModelResponse: vi.fn().mockResolvedValue({ markdown: '{}' }),
		}),
	},
}));

// Mock VaultAnalysisModal
vi.mock('../../src/ui/vault-analysis-modal', () => ({
	VaultAnalysisModal: vi.fn().mockImplementation(function () {
		return {
			open: vi.fn(),
			close: vi.fn(),
			addStep: vi.fn(),
			setStepInProgress: vi.fn(),
			setStepComplete: vi.fn(),
			setStepFailed: vi.fn(),
			setComplete: vi.fn(),
			updateStatus: vi.fn(),
			currentStep: 'collect',
		};
	}),
}));

import { TFile, TFolder, Notice } from 'obsidian';
import { ModelClientFactory } from '../../src/api';
import { VaultAnalyzer } from '../../src/services/vault-analyzer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockLogger(): any {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function createMockFile(path: string, mtime: number = 0): any {
	return new (TFile as any)(path, mtime);
}

function createMockFolder(path: string, name?: string): any {
	return new (TFolder as any)(path, name);
}

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				getRoot: vi.fn().mockReturnValue(createMockFolder('', '')),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				read: vi.fn().mockResolvedValue(''),
				getName: vi.fn().mockReturnValue('test-vault'),
			},
			workspace: {
				openLinkText: vi.fn().mockResolvedValue(undefined),
			},
		},
		settings: {
			historyFolder: 'gemini-scribe',
			chatModelName: 'gemini-2.5-flash',
			temperature: 1,
			topP: 0.95,
		},
		logger: createMockLogger(),
		agentsMemory: {
			read: vi.fn().mockResolvedValue(null),
			render: vi.fn().mockReturnValue('rendered content'),
			write: vi.fn().mockResolvedValue(undefined),
			getMemoryFilePath: vi.fn().mockReturnValue('gemini-scribe/AGENTS.md'),
		},
		examplePrompts: {
			read: vi.fn().mockResolvedValue(null),
			write: vi.fn().mockResolvedValue(undefined),
		},
		prompts: {
			vaultAnalysisPrompt: vi.fn().mockReturnValue('Analyze this vault'),
			examplePromptsPrompt: vi.fn().mockReturnValue('Generate example prompts'),
		},
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultAnalyzer', () => {
	let analyzer: VaultAnalyzer;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
		analyzer = new VaultAnalyzer(mockPlugin);
	});

	// ── Private method access helpers ────────────────────────────────────
	// Many methods are private, so we test them through the public API or
	// via cast to `any` for pure logic methods.

	describe('buildFolderStructure', () => {
		it('should return empty string when depth exceeds maxDepth', () => {
			const folder = createMockFolder('deep', 'deep');
			const result = (analyzer as any).buildFolderStructure(folder, 4, 3);
			expect(result).toBe('');
		});

		it('should skip system folders (.obsidian)', () => {
			const folder = createMockFolder('.obsidian', '.obsidian');
			const result = (analyzer as any).buildFolderStructure(folder, 1, 3);
			expect(result).toBe('');
		});

		it('should skip the plugin history folder', () => {
			const folder = createMockFolder('gemini-scribe', 'gemini-scribe');
			const result = (analyzer as any).buildFolderStructure(folder, 1, 3);
			expect(result).toBe('');
		});

		it('should include folder name with file count at depth > 0', () => {
			const folder = createMockFolder('notes', 'notes');
			const mdFile = createMockFile('notes/test.md');
			mdFile.extension = 'md';
			folder.children = [mdFile];

			const result = (analyzer as any).buildFolderStructure(folder, 1, 3);

			expect(result).toContain('📁 **notes/**');
			expect(result).toContain('(1 files)');
		});

		it('should recurse into subfolders', () => {
			const root = createMockFolder('', '');
			const subfolder = createMockFolder('sub', 'sub');
			const mdFile = createMockFile('sub/note.md');
			mdFile.extension = 'md';
			subfolder.children = [mdFile];
			root.children = [subfolder];

			const result = (analyzer as any).buildFolderStructure(root, 0, 3);

			expect(result).toContain('📁 **sub/**');
		});

		it('should limit file listing to 5 files and show remainder', () => {
			const folder = createMockFolder('many', 'many');
			const files = Array.from({ length: 8 }, (_, i) => {
				const f = createMockFile(`many/file${i}.md`);
				f.extension = 'md';
				return f;
			});
			folder.children = files;

			const result = (analyzer as any).buildFolderStructure(folder, 1, 3);

			// Should show 5 files and a "3 more files" line
			expect(result).toContain('... (3 more files)');
		});
	});

	describe('countMarkdownFilesInFolder', () => {
		it('should count markdown files in a flat folder', () => {
			const folder = createMockFolder('notes', 'notes');
			const md1 = createMockFile('notes/a.md');
			md1.extension = 'md';
			const md2 = createMockFile('notes/b.md');
			md2.extension = 'md';
			const txt = createMockFile('notes/c.txt');
			txt.extension = 'txt';
			folder.children = [md1, md2, txt];

			const count = (analyzer as any).countMarkdownFilesInFolder(folder);
			expect(count).toBe(2);
		});

		it('should count recursively in nested folders', () => {
			const root = createMockFolder('root', 'root');
			const sub = createMockFolder('root/sub', 'sub');
			const md1 = createMockFile('root/a.md');
			md1.extension = 'md';
			const md2 = createMockFile('root/sub/b.md');
			md2.extension = 'md';
			sub.children = [md2];
			root.children = [md1, sub];

			const count = (analyzer as any).countMarkdownFilesInFolder(root);
			expect(count).toBe(2);
		});

		it('should return 0 for empty folder', () => {
			const folder = createMockFolder('empty', 'empty');
			folder.children = [];

			const count = (analyzer as any).countMarkdownFilesInFolder(folder);
			expect(count).toBe(0);
		});
	});

	describe('getSampleFileNames', () => {
		it('should filter out system folder files', () => {
			const files = [
				createMockFile('gemini-scribe/history.md', 100),
				createMockFile('.obsidian/config.md', 200),
				createMockFile('notes/real.md', 300),
			];

			const result = (analyzer as any).getSampleFileNames(files, 20);

			expect(result).toHaveLength(1);
			expect(result[0]).toContain('real');
		});

		it('should sort by recent modification time', () => {
			const files = [createMockFile('old.md', 100), createMockFile('newest.md', 300), createMockFile('middle.md', 200)];

			const result = (analyzer as any).getSampleFileNames(files, 20);

			expect(result[0]).toContain('newest');
			expect(result[2]).toContain('old');
		});

		it('should limit results to the specified count', () => {
			const files = Array.from({ length: 30 }, (_, i) => createMockFile(`file${i}.md`, i));

			const result = (analyzer as any).getSampleFileNames(files, 5);

			expect(result).toHaveLength(5);
		});

		it('should include folder path in file names', () => {
			const file = createMockFile('projects/research/paper.md', 100);

			const result = (analyzer as any).getSampleFileNames([file], 20);

			expect(result[0]).toBe('projects/research/paper');
		});
	});

	// ── parseAnalysisResponse ────────────────────────────────────────────

	describe('parseAnalysisResponse', () => {
		it('should parse valid JSON from code block', () => {
			const response = '```json\n{"vaultOverview": "Test overview", "organization": "By topic"}\n```';
			const result = (analyzer as any).parseAnalysisResponse(response);

			expect(result).not.toBeNull();
			expect(result.vaultOverview).toBe('Test overview');
			expect(result.organization).toBe('By topic');
		});

		it('should parse raw JSON without code blocks', () => {
			const response = '{"vaultOverview": "Direct JSON"}';
			const result = (analyzer as any).parseAnalysisResponse(response);

			expect(result).not.toBeNull();
			expect(result.vaultOverview).toBe('Direct JSON');
		});

		it('should return null for malformed JSON', () => {
			const response = 'This is not JSON at all';
			const result = (analyzer as any).parseAnalysisResponse(response);

			expect(result).toBeNull();
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});

		it('should return null for non-object JSON', () => {
			const response = '"just a string"';
			const result = (analyzer as any).parseAnalysisResponse(response);

			expect(result).toBeNull();
		});

		it('should default missing fields to empty strings', () => {
			const response = '{"vaultOverview": "Only overview"}';
			const result = (analyzer as any).parseAnalysisResponse(response);

			expect(result).not.toBeNull();
			expect(result.vaultOverview).toBe('Only overview');
			expect(result.organization).toBe('');
			expect(result.keyTopics).toBe('');
			expect(result.userPreferences).toBe('');
			expect(result.customInstructions).toBe('');
		});
	});

	// ── parseExamplePromptsResponse ──────────────────────────────────────

	describe('parseExamplePromptsResponse', () => {
		it('should parse valid JSON array from code block', () => {
			const response = '```json\n[{"icon": "🔍", "text": "Search notes"}]\n```';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);
			expect(result[0].icon).toBe('🔍');
			expect(result[0].text).toBe('Search notes');
		});

		it('should parse raw JSON array without code blocks', () => {
			const response = '[{"icon": "📝", "text": "Write summary"}]';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);
		});

		it('should find array within surrounding text', () => {
			const response = 'Here are the prompts:\n[{"icon": "✨", "text": "Generate ideas"}]\nDone!';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);
		});

		it('should return null for non-array JSON', () => {
			const response = '{"icon": "📝", "text": "Not an array"}';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find JSON array'));
		});

		it('should return null when no JSON array can be found', () => {
			const response = 'No JSON here at all!';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
		});

		it('should validate required fields (icon and text must be non-empty strings)', () => {
			const response = '[{"icon": "", "text": "Valid text"}]';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid example prompt'));
		});

		it('should reject entries with missing icon field', () => {
			const response = '[{"text": "Missing icon"}]';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
		});

		it('should reject entries with missing text field', () => {
			const response = '[{"icon": "🔍"}]';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
		});

		it('should handle malformed JSON gracefully', () => {
			const response = '```json\n[{"icon": "🔍", text: broken}]\n```';
			const result = (analyzer as any).parseExamplePromptsResponse(response);

			expect(result).toBeNull();
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});
	});

	// ── collectVaultInformation & caching ────────────────────────────────

	describe('collectVaultInformation', () => {
		it('should include file count in vault info', () => {
			const files = [createMockFile('a.md', 100), createMockFile('b.md', 200)];
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files);

			const result = (analyzer as any).collectVaultInformation();

			expect(result).toContain('2 markdown files');
		});

		it('should use cache for large vaults (>1000 files) within TTL', () => {
			// First call: populate cache
			const files = Array.from({ length: 1001 }, (_, i) => createMockFile(`file${i}.md`, 100));
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files);

			const result1 = (analyzer as any).collectVaultInformation();

			// Second call: should use cache
			const result2 = (analyzer as any).collectVaultInformation();

			expect(result1).toBe(result2);
			expect(mockPlugin.logger.log).toHaveBeenCalledWith(expect.stringContaining('Using cached'));
		});

		it('should not cache for small vaults (<= 1000 files)', () => {
			const files = [createMockFile('a.md', 100)];
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files);

			(analyzer as any).collectVaultInformation();

			expect((analyzer as any).vaultInfoCache).toBeNull();
		});
	});

	// ── ensureMinimumDelay ────────────────────────────────────────────────

	describe('ensureMinimumDelay', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should wait when elapsed < minimumMs', async () => {
			const startTime = Date.now();
			// Advance only 500ms so elapsed is 500 and remaining is 1500
			vi.advanceTimersByTime(500);

			const promise = (analyzer as any).ensureMinimumDelay(startTime, 2000);
			// Advance remaining 1500ms to resolve the setTimeout
			vi.advanceTimersByTime(1500);

			await promise; // should resolve without hanging
		});

		it('should return immediately when elapsed >= minimumMs', async () => {
			const startTime = Date.now();
			// Advance well past the minimum
			vi.advanceTimersByTime(3000);

			// This should resolve immediately (no setTimeout)
			await (analyzer as any).ensureMinimumDelay(startTime, 2000);
		});
	});

	// ── buildAnalysisPrompt ──────────────────────────────────────────────

	describe('buildAnalysisPrompt', () => {
		it('should combine base prompt with vault info', () => {
			mockPlugin.prompts.vaultAnalysisPrompt.mockReturnValue('BASE PROMPT');

			const result = (analyzer as any).buildAnalysisPrompt('VAULT INFO', 'existing content');

			expect(result).toBe('BASE PROMPT\n\nVAULT INFO');
			expect(mockPlugin.prompts.vaultAnalysisPrompt).toHaveBeenCalledWith({
				existingContent: 'existing content',
			});
		});

		it('should pass empty string when existingContent is null', () => {
			mockPlugin.prompts.vaultAnalysisPrompt.mockReturnValue('BASE PROMPT');

			const result = (analyzer as any).buildAnalysisPrompt('VAULT INFO', null);

			expect(result).toBe('BASE PROMPT\n\nVAULT INFO');
			expect(mockPlugin.prompts.vaultAnalysisPrompt).toHaveBeenCalledWith({
				existingContent: '',
			});
		});
	});

	// ── collectVaultInformation – cache invalidation ─────────────────────

	describe('collectVaultInformation – cache invalidation', () => {
		it('should invalidate cache when fileCount changes', () => {
			// Populate cache with 1001 files
			const files1 = Array.from({ length: 1001 }, (_, i) => createMockFile(`file${i}.md`, 100));
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files1);
			const result1 = (analyzer as any).collectVaultInformation();

			// Change to 1002 files — cache should be invalidated
			const files2 = Array.from({ length: 1002 }, (_, i) => createMockFile(`file${i}.md`, 100));
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files2);
			const result2 = (analyzer as any).collectVaultInformation();

			expect(result2).not.toBe(result1);
			expect(result2).toContain('1002 markdown files');
		});

		it('should invalidate cache when lastModified changes', () => {
			const files1 = Array.from({ length: 1001 }, (_, i) => createMockFile(`file${i}.md`, 100));
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files1);
			(analyzer as any).collectVaultInformation();

			// Same file count but newer modification time
			const files2 = Array.from({ length: 1001 }, (_, i) => createMockFile(`file${i}.md`, 999));
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files2);
			(analyzer as any).collectVaultInformation();

			// getRoot called twice proves cache was invalidated (once per collect)
			expect(mockPlugin.app.vault.getRoot).toHaveBeenCalledTimes(2);
		});

		it('should invalidate cache when TTL expires', () => {
			vi.useFakeTimers();
			try {
				const files = Array.from({ length: 1001 }, (_, i) => createMockFile(`file${i}.md`, 100));
				mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files);
				const result1 = (analyzer as any).collectVaultInformation();

				// Advance time past the 5-minute TTL
				vi.advanceTimersByTime(6 * 60 * 1000);

				const result2 = (analyzer as any).collectVaultInformation();

				// getRoot should have been called twice (cache miss both times)
				expect(mockPlugin.app.vault.getRoot).toHaveBeenCalledTimes(2);
				// The string content is the same since the data hasn't changed,
				// but getRoot being called twice proves the cache was invalidated
			} finally {
				vi.useRealTimers();
			}
		});
	});

	// ── initializeAgentsMemory ───────────────────────────────────────────

	describe('initializeAgentsMemory', () => {
		let mockModelApi: any;

		beforeEach(() => {
			// Stub ensureMinimumDelay to avoid real timer issues
			vi.spyOn(analyzer as any, 'ensureMinimumDelay').mockResolvedValue(undefined);
		});

		function setupModelMock(analysisMarkdown: string, examplePromptsMarkdown: string) {
			mockModelApi = {
				generateModelResponse: vi
					.fn()
					.mockResolvedValueOnce({ markdown: analysisMarkdown })
					.mockResolvedValueOnce({ markdown: examplePromptsMarkdown }),
			};
			(ModelClientFactory.createChatModel as any).mockReturnValue(mockModelApi);
		}

		it('should complete full happy path with all 7 steps', async () => {
			setupModelMock(
				'{"vaultOverview":"overview","organization":"org","keyTopics":"topics","userPreferences":"prefs","customInstructions":"instr"}',
				'[{"icon":"✨","text":"Test prompt"}]'
			);

			await analyzer.initializeAgentsMemory();

			// Verify model was called twice (analysis + example prompts)
			expect(mockModelApi.generateModelResponse).toHaveBeenCalledTimes(2);
			// Verify rendered content was written
			expect(mockPlugin.agentsMemory.render).toHaveBeenCalled();
			expect(mockPlugin.agentsMemory.write).toHaveBeenCalledWith('rendered content');
			// Verify example prompts were saved
			expect(mockPlugin.examplePrompts.write).toHaveBeenCalledWith([{ icon: '✨', text: 'Test prompt' }]);
		});

		it('should set step failed and show Notice when parseAnalysisResponse returns null', async () => {
			setupModelMock('totally not json!!!', '[{"icon":"✨","text":"Test prompt"}]');

			await analyzer.initializeAgentsMemory();

			// Model should only be called once — we bail after parse failure
			expect(mockModelApi.generateModelResponse).toHaveBeenCalledTimes(1);
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
			// agentsMemory.write should NOT have been called
			expect(mockPlugin.agentsMemory.write).not.toHaveBeenCalled();
		});

		it('should warn and continue when example prompts response is null', async () => {
			setupModelMock(
				'{"vaultOverview":"overview","organization":"org","keyTopics":"topics","userPreferences":"prefs","customInstructions":"instr"}',
				'not valid json at all'
			);

			await analyzer.initializeAgentsMemory();

			// agentsMemory.write should still be called (the main analysis succeeded)
			expect(mockPlugin.agentsMemory.write).toHaveBeenCalledWith('rendered content');
			// examplePrompts.write should NOT have been called
			expect(mockPlugin.examplePrompts.write).not.toHaveBeenCalled();
			// Should have logged a warning
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to generate example prompts')
			);
		});

		it('should report "updated" when existing AGENTS.md exists', async () => {
			mockPlugin.agentsMemory.read.mockResolvedValue('existing content here');
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"Write"}]');

			await analyzer.initializeAgentsMemory();

			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('updated'));
		});

		it('should report "created" when no existing AGENTS.md', async () => {
			mockPlugin.agentsMemory.read.mockResolvedValue(null);
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"Write"}]');

			await analyzer.initializeAgentsMemory();

			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('created'));
		});

		it('should log error and set step failed when an error is thrown', async () => {
			(ModelClientFactory.createChatModel as any).mockReturnValue({
				generateModelResponse: vi.fn().mockRejectedValue(new Error('API down')),
			});

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to initialize AGENTS.md'),
				expect.any(Error)
			);
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize AGENTS.md'));
		});

		it('should open file via workspace.openLinkText when file is found after write', async () => {
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"Write"}]');
			// Simulate the file being found in the vault after writing
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(new (TFile as any)('gemini-scribe/AGENTS.md'));

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.app.workspace.openLinkText).toHaveBeenCalledWith('gemini-scribe/AGENTS.md', '', false);
		});

		it('should NOT call openLinkText when file is not found after write', async () => {
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"Write"}]');
			// Simulate file NOT found (returns null — which is already the default)
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.app.workspace.openLinkText).not.toHaveBeenCalled();
		});

		it('should pass existing example prompts to examplePromptsPrompt when they exist', async () => {
			const existingPrompts = [{ icon: '🔍', text: 'Old prompt' }];
			mockPlugin.examplePrompts.read.mockResolvedValue(existingPrompts);
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"New prompt"}]');

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.prompts.examplePromptsPrompt).toHaveBeenCalledWith(
				expect.any(String),
				JSON.stringify(existingPrompts, null, 2)
			);
		});

		it('should pass undefined for existingPromptsString when no existing prompts', async () => {
			mockPlugin.examplePrompts.read.mockResolvedValue(null);
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"New prompt"}]');

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.prompts.examplePromptsPrompt).toHaveBeenCalledWith(expect.any(String), undefined);
		});

		it('should pass undefined when existing prompts is an empty array', async () => {
			mockPlugin.examplePrompts.read.mockResolvedValue([]);
			setupModelMock('{"vaultOverview":"overview"}', '[{"icon":"📝","text":"New prompt"}]');

			await analyzer.initializeAgentsMemory();

			expect(mockPlugin.prompts.examplePromptsPrompt).toHaveBeenCalledWith(expect.any(String), undefined);
		});
	});
});
