import { describe, test, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { openPluginSettingsTab } from '../../src/utils/obsidian-settings';

describe('openPluginSettingsTab', () => {
	test('opens the settings modal and switches to the plugin tab', () => {
		const open = vi.fn();
		const openTabById = vi.fn();
		const app = { setting: { open, openTabById } } as unknown as App;

		openPluginSettingsTab(app, 'gemini-scribe');

		expect(open).toHaveBeenCalledTimes(1);
		expect(openTabById).toHaveBeenCalledWith('gemini-scribe');
	});

	test('opens the requested tab id, not a hardcoded one', () => {
		const open = vi.fn();
		const openTabById = vi.fn();
		const app = { setting: { open, openTabById } } as unknown as App;

		openPluginSettingsTab(app, 'some-other-plugin');

		expect(openTabById).toHaveBeenCalledWith('some-other-plugin');
	});

	test('calls open() before openTabById() so the modal exists when the tab is selected', () => {
		const calls: string[] = [];
		const open = vi.fn(() => calls.push('open'));
		const openTabById = vi.fn(() => calls.push('openTabById'));
		const app = { setting: { open, openTabById } } as unknown as App;

		openPluginSettingsTab(app, 'gemini-scribe');

		expect(calls).toEqual(['open', 'openTabById']);
	});
});
