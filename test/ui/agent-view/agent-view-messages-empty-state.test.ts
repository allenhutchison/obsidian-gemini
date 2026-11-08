/**
 * The agent view's empty state names a disabled "Keep session history"
 * setting (#1730). With history off nothing is written and no error appears,
 * so users concluded the plugin folder was broken.
 */
import { App, Component } from 'obsidian';
import { AgentViewMessages } from '../../../src/ui/agent-view/agent-view-messages';
import type ObsidianGemini from '../../../src/main';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
	getLanguage: () => 'en',
}));

const mockOpenSettings = vi.fn();
vi.mock('../../../src/utils/obsidian-settings', () => ({
	openPluginSettingsTab: (...args: unknown[]) => mockOpenSettings(...args),
}));

function addDOMMethods(el: any): any {
	el.createDiv = function (options?: any) {
		return this.createEl('div', options);
	};
	el.createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		addDOMMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	el.createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	el.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	return el;
}

function build(chatHistory: boolean) {
	const chatContainer = addDOMMethods(document.createElement('div'));
	const app = {} as unknown as App;
	const plugin = {
		settings: { chatHistory, historyFolder: 'gemini-scribe' },
		manifest: { id: 'gemini-scribe' },
		app,
		agentsMemory: { exists: vi.fn().mockResolvedValue(true) },
		sessionManager: { getRecentAgentSessions: vi.fn().mockResolvedValue([]) },
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
	} as unknown as ObsidianGemini;
	const messages = new AgentViewMessages(
		app,
		chatContainer,
		plugin,
		document.createElement('div'),
		{} as unknown as Component
	);
	return { messages, chatContainer };
}

describe('AgentViewMessages — session history off hint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows the hint, with a working settings link, when history is off', async () => {
		const { messages, chatContainer } = build(false);
		await messages.showEmptyState(null, vi.fn(), vi.fn());

		const hint = chatContainer.querySelector('.gemini-agent-history-off');
		expect(hint).not.toBeNull();
		expect(hint!.textContent).toContain('Session history is off');

		const link = hint!.querySelector('.gemini-agent-history-off-link') as HTMLElement;
		link.click();
		expect(mockOpenSettings).toHaveBeenCalledWith(expect.anything(), 'gemini-scribe');
	});

	it('shows no hint when history is on', async () => {
		const { messages, chatContainer } = build(true);
		await messages.showEmptyState(null, vi.fn(), vi.fn());

		expect(chatContainer.querySelector('.gemini-agent-empty-chat')).not.toBeNull();
		expect(chatContainer.querySelector('.gemini-agent-history-off')).toBeNull();
	});
});
