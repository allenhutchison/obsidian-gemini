import { App, Component } from 'obsidian';
import { AgentViewMessages } from '../../../src/ui/agent-view/agent-view-messages';
import type ObsidianGemini from '../../../src/main';
import type { Tool } from '../../../src/tools/types';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
}));

// Augment a jsdom element with the Obsidian DOM helpers the card relies on.
function addDOMMethods(el: any): any {
	el.createDiv = function (options?: any) {
		return this.createEl('div', options);
	};
	el.createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) elem.setAttribute(k, String(v));
		addDOMMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	el.createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	el.empty = function () {
		this.innerHTML = '';
	};
	el.setText = function (text: string) {
		this.textContent = text;
	};
	return el;
}

// #1780: a tool-permission card must not outlive the turn that asked for it.
describe('AgentViewMessages — settlePendingConfirmations', () => {
	let messages: AgentViewMessages;
	let chatContainer: HTMLElement;
	const tool = { name: 'google_search', displayName: 'Google Search', description: '' } as unknown as Tool;

	beforeEach(() => {
		chatContainer = addDOMMethods(document.createElement('div'));
		const plugin = { settings: {}, logger: { warn: vi.fn() } } as unknown as ObsidianGemini;
		messages = new AgentViewMessages(
			{} as unknown as App,
			chatContainer,
			plugin,
			document.createElement('div'),
			{} as unknown as Component
		);
	});

	it('resolves a pending card as cancelled and removes its buttons', async () => {
		const result = messages.displayConfirmationRequest(tool, { query: 'tides' }, 'exec-1');
		expect(chatContainer.querySelector('.gemini-agent-confirmation-btn-confirm')).not.toBeNull();

		messages.settlePendingConfirmations();

		await expect(result).resolves.toMatchObject({ confirmed: false });
		expect(chatContainer.querySelector('.gemini-agent-confirmation-btn-confirm')).toBeNull();
		expect(chatContainer.querySelector('.gemini-agent-confirmation-result')).not.toBeNull();
	});

	it('is a no-op once the card was answered', async () => {
		const result = messages.displayConfirmationRequest(tool, {}, 'exec-2');
		(chatContainer.querySelector('.gemini-agent-confirmation-btn-confirm') as HTMLButtonElement).click();
		await expect(result).resolves.toMatchObject({ confirmed: true });
		expect(() => messages.settlePendingConfirmations()).not.toThrow();
	});
});
