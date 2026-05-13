import type { Mock } from 'vitest';
import { AgentViewUI, UICallbacks } from '../../src/ui/agent-view/agent-view-ui';
import { App, TFile, TFolder, Notice } from 'obsidian';
import ObsidianGemini from '../../src/main';
import { shouldExcludePathForPlugin } from '../../src/utils/file-utils';

// Mock dependencies
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
}));
vi.mock('../../src/main');
vi.mock('../../src/ui/agent-view/file-picker-modal');
vi.mock('../../src/ui/agent-view/session-list-modal');
vi.mock('../../src/ui/agent-view/file-mention-modal');
vi.mock('../../src/ui/agent-view/session-settings-modal');
vi.mock('../../src/utils/dom-context');
vi.mock('../../src/utils/file-utils');

// Mock external ESM dependencies
vi.mock('@allenhutchison/gemini-utils', () => ({
	ResearchManager: class {},
	ReportGenerator: class {},
	Interaction: class {},
	EXTENSION_TO_MIME: {
		'.md': 'text/markdown',
		'.txt': 'text/plain',
		'.html': 'text/html',
		'.pdf': 'application/pdf',
	},
	TEXT_FALLBACK_EXTENSIONS: new Set(['.ts', '.js', '.json', '.css']),
}));
vi.mock('@google/genai', () => ({
	GoogleGenAI: class {},
}));

// Mock shouldExcludePathForPlugin implementation
(shouldExcludePathForPlugin as Mock).mockImplementation((path: string, _plugin: any) => {
	// Simple mock implementation
	return path.startsWith('.') || path === 'GEMINI_SCRIBE_HISTORY';
});

describe('AgentViewUI', () => {
	let app: App;
	let plugin: ObsidianGemini;
	let callbacks: UICallbacks;
	let agentViewUI: AgentViewUI;
	let container: HTMLElement;
	let userInput: HTMLDivElement;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Setup App mock
		app = {
			vault: {
				getAbstractFileByPath: vi.fn(),
				adapter: {
					basePath: '/Users/test/vault',
				},
				readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn(),
			},
			workspace: {
				getActiveFile: vi.fn(),
			},
		} as unknown as App;

		// Setup Plugin mock
		plugin = new ObsidianGemini(app, {} as any);
		plugin.logger = {
			debug: vi.fn(),
			error: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		} as any;

		// Setup Callbacks mock
		callbacks = {
			showFilePicker: vi.fn().mockResolvedValue(undefined),
			showFileMention: vi.fn().mockResolvedValue(undefined),
			showSkillPicker: vi.fn().mockResolvedValue(undefined),
			showSessionList: vi.fn().mockResolvedValue(undefined),
			showSessionSettings: vi.fn().mockResolvedValue(undefined),
			createNewSession: vi.fn().mockResolvedValue(undefined),
			sendMessage: vi.fn().mockResolvedValue(undefined),
			stopAgentLoop: vi.fn(),
			removeContextFile: vi.fn(),
			updateSessionHeader: vi.fn(),
			updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
			loadSession: vi.fn().mockResolvedValue(undefined),
			isCurrentSession: vi.fn(),
			addAttachment: vi.fn(),
			removeAttachment: vi.fn(),
			getAttachments: vi.fn().mockReturnValue([]),
			handleDroppedFiles: vi.fn(),
			switchProject: vi.fn(),
		};

		// Instantiate AgentViewUI
		agentViewUI = new AgentViewUI(app, plugin);

		// Create mock container
		container = document.createElement('div');
		document.body.appendChild(container);

		// Helper to create element mock
		const createElMock = vi.fn().mockImplementation((tag: string, options?: any) => {
			const el = document.createElement(tag);
			if (options?.cls) el.className = options.cls;
			if (options?.attr) {
				Object.entries(options.attr).forEach(([k, v]) => {
					el.setAttribute(k, v as string);
				});
			}
			if (options?.text) el.textContent = options.text;
			return el;
		});

		// Mock createDiv/createEl/empty on container and its children
		const setupMockElement = (el: HTMLElement) => {
			(el as any).createDiv = vi.fn().mockImplementation((opts) => {
				const div = document.createElement('div');
				if (opts?.cls) div.className = opts.cls;
				el.appendChild(div);
				setupMockElement(div);
				return div;
			});
			(el as any).createEl = createElMock;
			(el as any).createSpan = vi.fn().mockImplementation((opts) => {
				const span = document.createElement('span');
				if (opts?.cls) span.className = opts.cls;
				if (opts?.text) span.textContent = opts.text;
				el.appendChild(span);
				setupMockElement(span);
				return span;
			});
			(el as any).empty = vi.fn().mockImplementation(() => {
				el.innerHTML = '';
			});
			(el as any).addClass = vi.fn();
			(el as any).removeClass = vi.fn();
			(el as any).hasClass = vi.fn();
		};

		setupMockElement(container);

		// Render the interface to get userInput
		const elements = agentViewUI.createAgentInterface(container, null, callbacks);
		userInput = elements.userInput;
	});

	afterEach(() => {
		document.body.removeChild(container);
	});

	describe('Slash Command Handling', () => {
		it('should trigger showSkillPicker when / is typed in empty input', () => {
			vi.useFakeTimers();
			userInput.innerText = '';
			const event = new KeyboardEvent('keydown', { key: '/', bubbles: true });
			userInput.dispatchEvent(event);
			vi.runAllTimers();
			expect(callbacks.showSkillPicker).toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('should not trigger showSkillPicker when / is typed mid-sentence', () => {
			vi.useFakeTimers();
			userInput.innerText = 'some text';
			const event = new KeyboardEvent('keydown', { key: '/', bubbles: true });
			userInput.dispatchEvent(event);
			vi.runAllTimers();
			expect(callbacks.showSkillPicker).not.toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	describe('Drop Handling', () => {
		const triggerDrop = async (dataTransfer: any) => {
			const event = new Event('drop', { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'dataTransfer', {
				value: dataTransfer,
			});
			// Mock stopPropagation/preventDefault
			event.preventDefault = vi.fn();
			event.stopPropagation = vi.fn();

			userInput.dispatchEvent(event);
			// Wait for async handler
			await new Promise((resolve) => window.setTimeout(resolve, 0));
			return event;
		};

		it('should handle filesystem file drops (checking against vault path)', async () => {
			// Mock TFile
			const mockFile = {
				path: 'folder/note.md',
				basename: 'note',
				extension: 'md',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			// Mock vault resolution
			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			// Simulate dropping a file from OS explorer inside the vault
			const droppedFile = {
				path: '/Users/test/vault/folder/note.md',
				name: 'note.md',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any).item = (_i: number) => droppedFile;
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			const event = await triggerDrop(dataTransfer);

			expect(event.preventDefault).toHaveBeenCalled();
			// .md is classified as TEXT → handleDroppedFiles
			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('folder/note.md');
		});

		it('should normalize Windows paths correctly', async () => {
			// Mock Windows-style paths
			(app.vault.adapter as any).basePath = 'C:\\Users\\test\\vault';

			const mockFile = {
				path: 'folder/note.md',
				extension: 'md',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			// Simulate Windows file path with backslashes
			const droppedFile = {
				path: 'C:\\Users\\test\\vault\\folder\\note.md',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			// Backslashes normalized to forward slashes for vault path resolution
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('folder/note.md');
		});

		it('should handle internal Wikilink drops', async () => {
			const mockFile = { path: 'My Note.md', extension: 'md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: vi.fn().mockReturnValue('[[My Note]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('My Note');
		});

		it('should handle internal Markdown link drops', async () => {
			const mockFile = { path: 'My Note.md', extension: 'md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: vi.fn().mockReturnValue('[Display Name](My%20Note.md)'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('My Note.md');
		});

		it('should deduplicate files', async () => {
			const mockFile = { path: 'note.md', extension: 'md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			// Drop text with two identical links
			const dataTransfer = {
				files: [],
				getData: vi.fn().mockReturnValue('[[note.md]]\n[[note.md]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			// Should be called only once with array of length 1
			expect((callbacks.handleDroppedFiles as Mock).mock.calls[0][0]).toHaveLength(1);
		});

		it('should exclude system folders', async () => {
			const mockFile = { path: '.obsidian/config', extension: 'config' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: vi.fn().mockReturnValue('[[.obsidian/config]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).not.toHaveBeenCalled();
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('excluded'), expect.any(Number));
		});

		it('should ignore drops outside the vault', async () => {
			const droppedFile = {
				path: '/Users/other/file.txt',
				type: 'text/plain', // Add a safe type so the fallback logic doesn't crash on undefined type
			};
			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
				getData: vi.fn().mockReturnValue(''), // Mock getData to return empty string for fallback
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			// Should NOT call handleDroppedFiles for non-vault files
			expect(callbacks.handleDroppedFiles).not.toHaveBeenCalled();
		});

		it('should route vault .png files as inline attachments (not context chips)', async () => {
			const mockFile = {
				path: 'images/photo.png',
				name: 'photo.png',
				extension: 'png',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);
			(app.vault.readBinary as Mock).mockResolvedValue(new ArrayBuffer(100));

			const droppedFile = {
				path: '/Users/test/vault/images/photo.png',
				name: 'photo.png',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			// Should NOT be added as context chip (text)
			expect(callbacks.handleDroppedFiles).not.toHaveBeenCalled();
			// Should be added as inline attachment
			expect(callbacks.addAttachment).toHaveBeenCalledTimes(1);
			expect(callbacks.addAttachment).toHaveBeenCalledWith(
				expect.objectContaining({
					mimeType: 'image/png',
					vaultPath: 'images/photo.png',
					fileName: 'photo.png',
				})
			);
		});

		it('should route vault .md files as context chips (not attachments)', async () => {
			const mockFile = {
				path: 'notes/test.md',
				name: 'test.md',
				extension: 'md',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			const droppedFile = {
				path: '/Users/test/vault/notes/test.md',
				name: 'test.md',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			// Should be added as context chip
			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			// Should NOT be an inline attachment
			expect(callbacks.addAttachment).not.toHaveBeenCalled();
		});

		it('should show Notice for unsupported file types like .zip', async () => {
			const mockFile = {
				path: 'files/archive.zip',
				name: 'archive.zip',
				extension: 'zip',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFile);

			const droppedFile = {
				path: '/Users/test/vault/files/archive.zip',
				name: 'archive.zip',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			// Neither context chip nor attachment
			expect(callbacks.handleDroppedFiles).not.toHaveBeenCalled();
			expect(callbacks.addAttachment).not.toHaveBeenCalled();
			// Should show unsupported notice
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('unsupported'), expect.any(Number));
		});

		it('should handle mixed file types from folder expansion', async () => {
			const mdFile = {
				path: 'folder/note.md',
				name: 'note.md',
				extension: 'md',
			} as unknown as TFile;
			Object.setPrototypeOf(mdFile, TFile.prototype);

			const pngFile = {
				path: 'folder/image.png',
				name: 'image.png',
				extension: 'png',
			} as unknown as TFile;
			Object.setPrototypeOf(pngFile, TFile.prototype);

			const zipFile = {
				path: 'folder/archive.zip',
				name: 'archive.zip',
				extension: 'zip',
			} as unknown as TFile;
			Object.setPrototypeOf(zipFile, TFile.prototype);

			// Create a mock folder with children
			const mockFolder = {
				path: 'folder',
				children: [mdFile, pngFile, zipFile],
			} as unknown as TFolder;
			Object.setPrototypeOf(mockFolder, TFolder.prototype);

			(app.vault.getAbstractFileByPath as Mock).mockReturnValue(mockFolder);
			(app.vault.readBinary as Mock).mockResolvedValue(new ArrayBuffer(100));

			const droppedFile = {
				path: '/Users/test/vault/folder',
				name: 'folder',
			};

			const dataTransfer = {
				files: [droppedFile],
				types: ['Files'],
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			await triggerDrop(dataTransfer);

			// Text file should be context chip
			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mdFile]);
			// PNG should be inline attachment
			expect(callbacks.addAttachment).toHaveBeenCalledTimes(1);
			expect(callbacks.addAttachment).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }));
			// Unsupported notice for .zip
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('unsupported'), expect.any(Number));
		});

		it('should enforce cumulative size limit for binary attachments', async () => {
			// Create a file that's just under the limit
			const bigBuffer = new ArrayBuffer(21 * 1024 * 1024); // 21MB — over the 20MB limit

			const bigFile = {
				path: 'videos/big.mp4',
				name: 'big.mp4',
				extension: 'mp4',
			} as unknown as TFile;
			Object.setPrototypeOf(bigFile, TFile.prototype);

			const smallFile = {
				path: 'images/small.png',
				name: 'small.png',
				extension: 'png',
			} as unknown as TFile;
			Object.setPrototypeOf(smallFile, TFile.prototype);

			// First file is small, second is big
			(app.vault.getAbstractFileByPath as Mock).mockReturnValueOnce(smallFile).mockReturnValueOnce(bigFile);

			(app.vault.readBinary as Mock)
				.mockResolvedValueOnce(new ArrayBuffer(100)) // small file
				.mockResolvedValueOnce(bigBuffer); // big file

			// Drop small file first (via text links since we need both resolved)
			const dataTransfer = {
				files: [],
				getData: vi.fn().mockReturnValue('[[images/small.png]]\n[[videos/big.mp4]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			// Small file should be attached
			expect(callbacks.addAttachment).toHaveBeenCalledTimes(1);
			// Big file should be skipped, notice shown
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('20MB'), expect.any(Number));
		});
	});
});
