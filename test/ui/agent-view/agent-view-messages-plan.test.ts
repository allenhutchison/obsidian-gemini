import { App } from 'obsidian';
import { AgentViewMessages } from '../../../src/ui/agent-view/agent-view-messages';
import type ObsidianGemini from '../../../src/main';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
}));

// Augment a jsdom element with the Obsidian DOM helpers showPlanApproval relies on.
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
	return el;
}

describe('AgentViewMessages — plan approval', () => {
	let messages: AgentViewMessages;
	let chatContainer: HTMLElement;

	beforeEach(() => {
		vi.clearAllMocks();
		chatContainer = addDOMMethods(document.createElement('div'));
		const app = {} as unknown as App;
		const plugin = {} as unknown as ObsidianGemini;
		const userInput = document.createElement('div') as HTMLDivElement;
		messages = new AgentViewMessages(app, chatContainer, plugin, userInput, {});
	});

	function queryButtons() {
		const buttons = chatContainer.querySelectorAll('.gemini-agent-plan-buttons button');
		return { approve: buttons[0] as HTMLButtonElement, reject: buttons[1] as HTMLButtonElement };
	}

	it('resolves true when the user clicks Approve & Execute', async () => {
		const decision = messages.showPlanApproval('1. Do the thing');
		// Let the async render settle so the buttons exist.
		await Promise.resolve();
		const { approve } = queryButtons();
		approve.click();
		await expect(decision).resolves.toBe(true);
		// Buttons are torn down after a decision.
		expect(chatContainer.querySelector('.gemini-agent-plan-buttons')).toBeNull();
	});

	it('resolves false when the user clicks Reject', async () => {
		const decision = messages.showPlanApproval('1. Do the thing');
		await Promise.resolve();
		const { reject } = queryButtons();
		reject.click();
		await expect(decision).resolves.toBe(false);
	});

	it('settlePendingPlanApproval(false) resolves a pending approval (Stop pressed)', async () => {
		const decision = messages.showPlanApproval('1. Do the thing');
		await Promise.resolve();
		// Simulate the Stop button / view teardown cancelling the in-flight approval.
		messages.settlePendingPlanApproval(false);
		await expect(decision).resolves.toBe(false);
		expect(chatContainer.querySelector('.gemini-agent-plan-buttons')).toBeNull();
	});

	it('settlePendingPlanApproval is a no-op when no approval is in flight', () => {
		expect(() => messages.settlePendingPlanApproval(false)).not.toThrow();
	});

	it('ignores a late button click after the approval was already settled', async () => {
		const decision = messages.showPlanApproval('1. Do the thing');
		await Promise.resolve();
		const { approve, reject } = queryButtons();
		approve.click();
		await expect(decision).resolves.toBe(true);
		// A stray click on the (now-removed) reject button must not flip the result.
		reject.click();
		await expect(decision).resolves.toBe(true);
	});
});
