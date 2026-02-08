import { AgentViewUI, UICallbacks } from '../../src/ui/agent-view/agent-view-ui';
import { App, TFile, TFolder, WorkspaceLeaf, Notice, normalizePath } from 'obsidian';
import ObsidianGemini from '../../src/main';
import { shouldExcludePathForPlugin } from '../../src/utils/file-utils';

// Mock dependencies
jest.mock('obsidian');
jest.mock('../../src/main');
jest.mock('../../src/ui/agent-view/file-picker-modal');
jest.mock('../../src/ui/agent-view/session-list-modal');
jest.mock('../../src/ui/agent-view/file-mention-modal');
jest.mock('../../src/ui/agent-view/session-settings-modal');
jest.mock('../../src/utils/dom-context');
jest.mock('../../src/utils/file-utils');

// Mock external ESM dependencies
jest.mock('@allenhutchison/gemini-utils', () => ({
	ResearchManager: class {},
	ReportGenerator: class {},
	Interaction: class {},
}));
jest.mock('@google/genai', () => ({
	GoogleGenAI: class {},
}));

// Mock shouldExcludePathForPlugin implementation
(shouldExcludePathForPlugin as jest.Mock).mockImplementation((path: string, plugin: any) => {
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
		jest.clearAllMocks();

		// Setup App mock
		app = {
			vault: {
				getAbstractFileByPath: jest.fn(),
				adapter: {
					basePath: '/Users/test/vault',
				},
			},
			metadataCache: {
				getFirstLinkpathDest: jest.fn(),
			},
			workspace: {
				getActiveFile: jest.fn(),
			},
		} as unknown as App;

		// Setup Plugin mock
		plugin = new ObsidianGemini(app, {} as any);
		plugin.logger = {
			debug: jest.fn(),
			error: jest.fn(),
			log: jest.fn(),
			warn: jest.fn(),
		} as any;

		// Setup Callbacks mock
		callbacks = {
			showFilePicker: jest.fn().mockResolvedValue(undefined),
			showFileMention: jest.fn().mockResolvedValue(undefined),
			showSessionList: jest.fn().mockResolvedValue(undefined),
			showSessionSettings: jest.fn().mockResolvedValue(undefined),
			createNewSession: jest.fn().mockResolvedValue(undefined),
			sendMessage: jest.fn().mockResolvedValue(undefined),
			stopAgentLoop: jest.fn(),
			removeContextFile: jest.fn(),
			updateContextFilesList: jest.fn(),
			updateSessionHeader: jest.fn(),
			updateSessionMetadata: jest.fn().mockResolvedValue(undefined),
			loadSession: jest.fn().mockResolvedValue(undefined),
			isCurrentSession: jest.fn(),
			addImageAttachment: jest.fn(),
			removeImageAttachment: jest.fn(),
			getImageAttachments: jest.fn(),
			handleDroppedFiles: jest.fn(),
		};

		// Instantiate AgentViewUI
		agentViewUI = new AgentViewUI(app, plugin);

		// Create mock container
		container = document.createElement('div');
		document.body.appendChild(container);

		// Helper to create element mock
		const createElMock = jest.fn().mockImplementation((tag: string, options?: any) => {
			const el = document.createElement(tag);
			if (options?.cls) el.className = options.cls;
			if (options?.attr) {
				Object.entries(options.attr).forEach(([k, v]) => el.setAttribute(k, v as string));
			}
			if (options?.text) el.textContent = options.text;
			return el;
		});

		// Mock createDiv/createEl/empty on container and its children
		const setupMockElement = (el: HTMLElement) => {
			(el as any).createDiv = jest.fn().mockImplementation((opts) => {
				const div = document.createElement('div');
				if (opts?.cls) div.className = opts.cls;
				el.appendChild(div);
				setupMockElement(div);
				return div;
			});
			(el as any).createEl = createElMock;
			(el as any).createSpan = jest.fn().mockImplementation((opts) => {
				const span = document.createElement('span');
				if (opts?.cls) span.className = opts.cls;
				if (opts?.text) span.textContent = opts.text;
				el.appendChild(span);
				setupMockElement(span);
				return span;
			});
			(el as any).empty = jest.fn().mockImplementation(() => {
				el.innerHTML = '';
			});
			(el as any).addClass = jest.fn();
			(el as any).removeClass = jest.fn();
			(el as any).hasClass = jest.fn();
		};

		setupMockElement(container);

		// Render the interface to get userInput
		const elements = agentViewUI.createAgentInterface(container, null, callbacks);
		userInput = elements.userInput;
	});

	afterEach(() => {
		document.body.removeChild(container);
	});

	describe('Drop Handling', () => {
		const triggerDrop = async (dataTransfer: any) => {
			const event = new Event('drop', { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'dataTransfer', {
				value: dataTransfer,
			});
			// Mock stopPropagation/preventDefault
			event.preventDefault = jest.fn();
			event.stopPropagation = jest.fn();

			userInput.dispatchEvent(event);
			// Wait for async handler
			await new Promise((resolve) => setTimeout(resolve, 0));
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
			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

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
			(dataTransfer.files as any).item = (i: number) => droppedFile;
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			const event = await triggerDrop(dataTransfer);

			expect(event.preventDefault).toHaveBeenCalled();
			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('folder/note.md');
		});

		it('should normalize Windows paths correctly', async () => {
			// Override normalizePath mock for this test to simulate Windows behavior
			(normalizePath as jest.Mock).mockImplementation((path) => path.replace(/\\/g, '/'));

			// Mock Windows-style paths
			(app.vault.adapter as any).basePath = 'C:\\Users\\test\\vault';

			const mockFile = {
				path: 'folder/note.md',
			} as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

			// Simulate Windows file path
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
			// normalizePath replaces backslashes with forward slashes in 'folder/note.md'
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('folder/note.md');

			// Reset mock
			(normalizePath as jest.Mock).mockImplementation((path) => path);
		});

		it('should handle internal Wikilink drops', async () => {
			const mockFile = { path: 'My Note.md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: jest.fn().mockReturnValue('[[My Note]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('My Note');
		});

		it('should handle internal Markdown link drops', async () => {
			const mockFile = { path: 'My Note.md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: jest.fn().mockReturnValue('[Display Name](My%20Note.md)'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('My Note.md');
		});

		it('should deduplicate files', async () => {
			const mockFile = { path: 'note.md' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

			// Drop text with two identical links
			const dataTransfer = {
				files: [],
				getData: jest.fn().mockReturnValue('[[note.md]]\n[[note.md]]'),
				types: ['text/plain'],
			};

			await triggerDrop(dataTransfer);

			expect(callbacks.handleDroppedFiles).toHaveBeenCalledWith([mockFile]);
			// Should be called only once with array of length 1
			expect((callbacks.handleDroppedFiles as jest.Mock).mock.calls[0][0]).toHaveLength(1);
		});

		it('should exclude system folders', async () => {
			const mockFile = { path: '.obsidian/config' } as unknown as TFile;
			Object.setPrototypeOf(mockFile, TFile.prototype);

			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

			const dataTransfer = {
				files: [],
				getData: jest.fn().mockReturnValue('[[.obsidian/config]]'),
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
				getData: jest.fn().mockReturnValue(''), // Mock getData to return empty string for fallback
			};
			Object.defineProperty(dataTransfer.files, 'length', { value: 1 });
			(dataTransfer.files as any)[Symbol.iterator] = function* () {
				yield droppedFile;
			};

			const event = await triggerDrop(dataTransfer);

			// Should verify image processing or just return
			// Since we mock isSupportedImageType to false implicitly (undefined), it might show "Unsupported" or do nothing
			// But critically, it should NOT call handleDroppedFiles
			expect(callbacks.handleDroppedFiles).not.toHaveBeenCalled();
		});
	});
});
