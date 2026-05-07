import { describe, it, expect, vi, beforeEach } from 'vitest';

// Counters that the section-render mocks bump so the test can assert on
// per-section call counts. Declared with `var` so vi.mock's hoisted factory
// can capture them (TDZ safe).
// eslint-disable-next-line no-var
var generalCalls = 0;
// eslint-disable-next-line no-var
var uiCalls = 0;
// eslint-disable-next-line no-var
var automationCalls = 0;
// eslint-disable-next-line no-var
var agentConfigCalls = 0;
// eslint-disable-next-line no-var
var toolCalls = 0;
// eslint-disable-next-line no-var
var mcpCalls = 0;
// eslint-disable-next-line no-var
var ragCalls = 0;
// eslint-disable-next-line no-var
var debugCalls = 0;
// eslint-disable-next-line no-var
var advancedToggleCalls = 0;

// `gate` is a deferred promise the test resolves to release the first
// in-flight render. Letting `renderGeneralSettings` block on it lets us
// interleave a second display() call before the first finishes.
// eslint-disable-next-line no-var
var gate: Promise<void> | null = null;

vi.mock('../../src/ui/settings-general', () => ({
	renderGeneralSettings: vi.fn(async () => {
		generalCalls += 1;
		if (gate) await gate;
	}),
}));
vi.mock('../../src/ui/settings-ui', () => ({
	renderUISettings: vi.fn(() => {
		uiCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-automation', () => ({
	renderAutomationSettings: vi.fn(() => {
		automationCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-agent-config', () => ({
	renderAgentConfigSettings: vi.fn(async () => {
		agentConfigCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-tools', () => ({
	renderToolSettings: vi.fn(async () => {
		toolCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-mcp', () => ({
	renderMCPSettings: vi.fn(async () => {
		mcpCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-rag', () => ({
	renderRAGSettings: vi.fn(async () => {
		ragCalls += 1;
	}),
}));
vi.mock('../../src/ui/settings-debug', () => ({
	renderDebugSettings: vi.fn(() => {
		debugCalls += 1;
	}),
}));

vi.mock('obsidian', () => {
	class PluginSettingTab {
		app: unknown;
		plugin: unknown;
		containerEl = { empty: vi.fn() };
		constructor(app: unknown, plugin: unknown) {
			this.app = app;
			this.plugin = plugin;
		}
		display() {}
		hide() {}
	}
	class Setting {
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			advancedToggleCalls += 1;
			return this;
		}
		addToggle(cb: (t: any) => void) {
			cb({ setValue: () => ({ onChange: () => undefined }) });
			return this;
		}
		addButton(cb: (b: any) => void) {
			cb({
				setButtonText: () => ({ setClass: () => ({ onClick: () => undefined }) }),
			});
			return this;
		}
	}
	return { PluginSettingTab, Setting };
});

import ObsidianGeminiSettingTab from '../../src/ui/settings';

describe('ObsidianGeminiSettingTab.display() concurrent-call guard', () => {
	beforeEach(() => {
		generalCalls = 0;
		uiCalls = 0;
		automationCalls = 0;
		agentConfigCalls = 0;
		toolCalls = 0;
		mcpCalls = 0;
		ragCalls = 0;
		debugCalls = 0;
		advancedToggleCalls = 0;
		gate = null;
	});

	it('skips remaining sections when a second display() call interrupts a render', async () => {
		const plugin = { settings: { debugMode: false }, saveSettings: vi.fn() };
		const tab = new ObsidianGeminiSettingTab({} as never, plugin as never);

		let release!: () => void;
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		// Kick off the first render — it will block inside renderGeneralSettings
		// until we resolve the gate. Don't await yet.
		const first = tab.display();
		// Yield so renderGeneralSettings starts and bumps generalCalls.
		await Promise.resolve();
		expect(generalCalls).toBe(1);
		// Sync sections must NOT have run yet because of the gate.
		expect(uiCalls).toBe(0);
		expect(automationCalls).toBe(0);

		// While the first render is still awaiting the gate, the second call
		// arrives. With the token guard, the first render must abort after the
		// gate resolves and the second render owns the container.
		gate = null; // second render does not block
		const second = tab.display();

		// Release the first render. With the guard, it should bail out before
		// running renderUISettings / renderContextSettings.
		release();

		await Promise.all([first, second]);

		// renderGeneralSettings was called twice (once per display) but
		// downstream sections must have run exactly once total — the second
		// render's pass.
		expect(generalCalls).toBe(2);
		expect(uiCalls).toBe(1);
		expect(automationCalls).toBe(1);
		expect(ragCalls).toBe(1);
	});

	it('runs every always-on section exactly once for a single uncontended call', async () => {
		const plugin = { settings: { debugMode: false }, saveSettings: vi.fn() };
		const tab = new ObsidianGeminiSettingTab({} as never, plugin as never);

		await tab.display();

		expect(generalCalls).toBe(1);
		expect(uiCalls).toBe(1);
		expect(automationCalls).toBe(1);
		// Vault Search Index renders unconditionally (promoted out of advanced).
		expect(ragCalls).toBe(1);
		// Advanced-only sections stay hidden until "Show Advanced Settings" is on.
		expect(agentConfigCalls).toBe(0);
		expect(toolCalls).toBe(0);
		expect(mcpCalls).toBe(0);
		expect(debugCalls).toBe(0);
	});
});
