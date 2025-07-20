import { AgentView } from './agent-view';
import { SessionManager } from '../agent/session-manager';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolExecutionEngine } from '../tools/execution-engine';
import { SessionType } from '../types/agent';
import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

// Mock dependencies
jest.mock('../agent/session-history');
jest.mock('../tools/tool-registry');
jest.mock('../tools/execution-engine');
jest.mock('../ui/file-picker-modal');
jest.mock('../ui/session-settings-modal');

// Mock Obsidian
jest.mock('obsidian', () => {
	const mock = jest.requireActual('../../__mocks__/obsidian.js');
	return {
		...mock,
		ItemView: class ItemView {
			contentEl = document.createElement('div');
			containerEl = document.createElement('div');
			app: any = {};
			leaf: any = {};
			navigation = true;
			
			constructor(leaf: any) {
				this.leaf = leaf;
			}
			
			load() {}
			onload() {}
			onunload() {}
			getViewType() { return 'test'; }
			getDisplayText() { return 'Test'; }
			getIcon() { return 'test'; }
		},
		MarkdownRenderer: {
			render: jest.fn().mockResolvedValue(undefined)
		},
		setIcon: jest.fn(),
		Notice: jest.fn(),
		Menu: jest.fn().mockImplementation(() => ({
			addItem: jest.fn().mockReturnThis(),
			showAtMouseEvent: jest.fn()
		}))
	};
});

describe('AgentView UI Tests', () => {
	let plugin: any;
	let leaf: WorkspaceLeaf;
	let agentView: AgentView;

	beforeEach(() => {
		// Mock DOM
		document.body.innerHTML = '<div id="test-container"></div>';

		// Mock plugin
		plugin = {
			settings: {
				historyFolder: 'gemini-scribe',
				agentModelName: 'gemini-1.5-pro',
				enabledTools: ['read_files', 'write_files'],
				temperature: 0.7,
				topP: 0.95
			},
			sessionManager: new SessionManager(plugin),
			toolRegistry: new ToolRegistry(plugin),
			toolEngine: null, // Will be set after creation
			app: {
				workspace: {
					getLeaf: jest.fn(),
					revealLeaf: jest.fn()
				},
				vault: {
					getMarkdownFiles: jest.fn().mockReturnValue([])
				}
			},
			prompts: {
				agentSystemPrompt: jest.fn().mockReturnValue('System prompt'),
				agentContextPrompt: jest.fn().mockReturnValue('Context prompt')
			},
			geminiApi: {
				generateModelResponse: jest.fn().mockResolvedValue({
					markdown: 'Test response',
					candidates: [{
						content: {
							parts: [{ text: 'Test response' }]
						}
					}]
				})
			}
		};

		plugin.toolEngine = new ToolExecutionEngine(plugin, plugin.toolRegistry);

		// Create view
		leaf = {} as WorkspaceLeaf;
		agentView = new AgentView(leaf, plugin);
	});

	afterEach(() => {
		jest.clearAllMocks();
		document.body.innerHTML = '';
	});

	describe('Session UI Management', () => {
		it('should display session list in dropdown', async () => {
			// Create test sessions
			const session1 = await plugin.sessionManager.createAgentSession();
			const session2 = await plugin.sessionManager.createAgentSession();

			// Open view
			await agentView.onOpen();

			// Check session dropdown
			const sessionDropdown = agentView.containerEl.querySelector('.session-selector select') as HTMLSelectElement;
			expect(sessionDropdown).toBeTruthy();
			
			// Should have options for new session + existing sessions
			expect(sessionDropdown.options.length).toBeGreaterThanOrEqual(3);
		});

		it('should handle session switching', async () => {
			await agentView.onOpen();

			// Create and switch to new session
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			expect(agentView['currentSession']).toBe(session);
			
			// Check UI updates
			const header = agentView.containerEl.querySelector('.gemini-agent-header');
			expect(header?.textContent).toContain(session.title);
		});

		it('should show session configuration badges', async () => {
			await agentView.onOpen();

			// Create session with custom config
			const session = await plugin.sessionManager.createAgentSession();
			await plugin.sessionManager.updateSessionModelConfig(session.id, {
				model: 'custom-model',
				temperature: 0.5,
				promptTemplate: 'custom-prompt.md'
			});

			await agentView['loadSession'](session.id);

			// Check for configuration indicators
			const badges = agentView.containerEl.querySelectorAll('.gemini-agent-prompt-badge, .gemini-agent-settings-indicator');
			expect(badges.length).toBeGreaterThan(0);
		});
	});

	describe('Message Handling', () => {
		it('should display user and assistant messages', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Add user message
			await agentView['displayMessage']('Hello, agent!', 'user');
			
			// Add assistant message
			await agentView['displayMessage']('Hello! How can I help?', 'assistant');

			// Check messages in DOM
			const messages = agentView.containerEl.querySelectorAll('.message-content');
			expect(messages).toHaveLength(2);
			expect(messages[0].textContent).toContain('Hello, agent!');
			expect(messages[1].textContent).toContain('Hello! How can I help?');
		});

		it('should display tool calls in collapsible format', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Display tool call
			const toolCall = {
				name: 'read_file',
				arguments: { path: 'test.md' },
				result: { success: true, data: 'File content' }
			};

			await agentView['displayToolCall'](toolCall);

			// Check collapsible tool call display
			const toolCallEl = agentView.containerEl.querySelector('.tool-call');
			expect(toolCallEl).toBeTruthy();
			
			const details = toolCallEl?.querySelector('details');
			expect(details).toBeTruthy();
			expect(details?.querySelector('summary')?.textContent).toContain('read_file');
		});
	});

	describe('Context File Management', () => {
		it('should handle @ mentions for adding context files', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Mock file search
			const mockFiles = [
				{ path: 'note1.md', basename: 'note1' },
				{ path: 'note2.md', basename: 'note2' }
			];
			plugin.app.vault.getMarkdownFiles.mockReturnValue(mockFiles);

			// Trigger @ mention
			const input = agentView.containerEl.querySelector('.gemini-agent-input') as HTMLElement;
			input.textContent = 'Check @';
			
			// Simulate input event
			const event = new Event('input', { bubbles: true });
			input.dispatchEvent(event);

			// Should show file suggestions (implementation specific)
			// This would require more complex mocking of the suggestion system
		});

		it('should display context files as chips', async () => {
			await agentView.onOpen();
			
			// Create session with context files
			const session = await plugin.sessionManager.createAgentSession('Test Session', {
				contextFiles: [
					{ path: 'file1.md', basename: 'file1' } as any,
					{ path: 'file2.md', basename: 'file2' } as any
				]
			});

			await agentView['loadSession'](session.id);

			// Check context file chips
			const chips = agentView.containerEl.querySelectorAll('.context-file-chip');
			expect(chips).toHaveLength(2);
			expect(chips[0].textContent).toContain('file1');
		});
	});

	describe('Input Handling', () => {
		it('should handle message submission', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Type message
			const input = agentView.containerEl.querySelector('.gemini-agent-input') as HTMLElement;
			input.textContent = 'Test message';

			// Submit
			const sendButton = agentView.containerEl.querySelector('.gemini-agent-send') as HTMLButtonElement;
			sendButton.click();

			// Should call API
			expect(plugin.geminiApi.generateModelResponse).toHaveBeenCalled();
			
			// Input should be cleared
			expect(input.textContent).toBe('');
		});

		it('should handle multi-line input', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			const input = agentView.containerEl.querySelector('.gemini-agent-input') as HTMLElement;
			
			// Simulate Shift+Enter for new line
			const event = new KeyboardEvent('keydown', {
				key: 'Enter',
				shiftKey: true,
				bubbles: true
			});
			
			input.textContent = 'Line 1';
			input.dispatchEvent(event);
			
			// Should not submit with Shift+Enter
			expect(plugin.geminiApi.generateModelResponse).not.toHaveBeenCalled();
		});
	});

	describe('Session Settings Modal', () => {
		it('should open session settings modal', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Click settings button
			const settingsButton = agentView.containerEl.querySelector('.session-settings-button') as HTMLElement;
			expect(settingsButton).toBeTruthy();
			
			// Mock modal
			const modalSpy = jest.spyOn(agentView as any, 'openSessionSettings');
			settingsButton.click();
			
			expect(modalSpy).toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		it('should display error messages appropriately', async () => {
			await agentView.onOpen();
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Mock API error
			plugin.geminiApi.generateModelResponse.mockRejectedValue(new Error('API Error'));

			// Send message
			const input = agentView.containerEl.querySelector('.gemini-agent-input') as HTMLElement;
			input.textContent = 'Test';
			
			const sendButton = agentView.containerEl.querySelector('.gemini-agent-send') as HTMLButtonElement;
			sendButton.click();

			// Wait for error handling
			await new Promise(resolve => setTimeout(resolve, 100));

			// Should show error notice
			expect(jest.mocked(Notice)).toHaveBeenCalledWith(expect.stringContaining('Error'));
		});
	});

	describe('View Lifecycle', () => {
		it('should clean up resources on close', async () => {
			await agentView.onOpen();
			
			// Create active session
			const session = await plugin.sessionManager.createAgentSession();
			await agentView['loadSession'](session.id);

			// Close view
			await agentView.onClose();

			// Should clean up
			expect(agentView['currentSession']).toBeNull();
		});
	});
});