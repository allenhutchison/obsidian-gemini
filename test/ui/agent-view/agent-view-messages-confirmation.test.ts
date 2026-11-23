import { App, Component } from 'obsidian';
import { AgentViewMessages } from '../../../src/ui/agent-view/agent-view-messages';
import type { ObsidianGemini } from '../../../src/types/plugin';
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
	let plugin: ObsidianGemini;
	const tool = { name: 'google_search', displayName: 'Google Search', description: '' } as unknown as Tool;

	beforeEach(() => {
		chatContainer = addDOMMethods(document.createElement('div'));
		plugin = { settings: {}, logger: { warn: vi.fn() } } as unknown as ObsidianGemini;
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

	it('does not auto-open the diff view for a card settled before the open delay', async () => {
		vi.useFakeTimers();
		try {
			plugin.settings.alwaysShowDiffView = true;
			const openDiffView = vi.spyOn(messages as any, 'openDiffView').mockResolvedValue(undefined);
			const result = messages.displayConfirmationRequest(tool, {}, 'exec-3', {
				filePath: 'note.md',
				originalContent: 'a',
				proposedContent: 'b',
				isNewFile: false,
			});

			messages.settlePendingConfirmations();
			await vi.advanceTimersByTimeAsync(200);

			await expect(result).resolves.toMatchObject({ confirmed: false });
			expect(openDiffView).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('closes a diff view that finishes opening after the card settled', async () => {
		vi.useFakeTimers();
		try {
			plugin.settings.alwaysShowDiffView = true;
			const detach = vi.fn();
			let finishOpening: () => void = () => {};
			// Replace the loader with one that finishes only when the test says so.
			const slowOpen = (_ctx: unknown, _respond: unknown, onOpened: (view: unknown) => void): Promise<void> =>
				new Promise<void>((resolve) => {
					finishOpening = () => {
						onOpened({ leaf: { detach } });
						resolve();
					};
				});
			(messages as any).openDiffView = slowOpen;
			const result = messages.displayConfirmationRequest(tool, {}, 'exec-4', {
				filePath: 'note.md',
				originalContent: 'a',
				proposedContent: 'b',
				isNewFile: false,
			});
			await vi.advanceTimersByTimeAsync(200);

			messages.settlePendingConfirmations();
			finishOpening();

			await expect(result).resolves.toMatchObject({ confirmed: false });
			expect(detach).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
