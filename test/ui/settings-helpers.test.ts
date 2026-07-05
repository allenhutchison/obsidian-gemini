/**
 * Unit tests for `createDebouncedSave` — the shared debounced-`saveSettings()`
 * helper consumed by the settings renderers (settings-ui / -general /
 * -agent-config / -rag). Covers the success path, the error path (logs +
 * Notice), and the optional `logLabel` passthrough.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { createDebouncedSave } from '../../src/ui/settings-helpers';

vi.mock('../../src/i18n', () => ({
	t: (key: string, vars?: Record<string, unknown>) => `${key}:${vars?.error ?? ''}`,
}));

vi.mock('../../src/utils/error-utils', () => ({
	getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// The obsidian `debounce` mock defers firing until `.run()` is called, so tests
// drive it explicitly. `createDebouncedSave` returns that debouncer typed as
// `() => void`; cast to reach `.run()`.
type Debounced = (() => void) & { run: () => void };

function makePlugin() {
	return {
		saveSettings: vi.fn().mockResolvedValue(undefined),
		logger: { error: vi.fn() },
	};
}

// Flush the async callback that `.run()` invokes but does not await.
const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe('createDebouncedSave', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls saveSettings on the success path without logging or a Notice', async () => {
		const plugin = makePlugin();
		const save = createDebouncedSave(plugin as any) as Debounced;

		save();
		save.run();
		await flush();

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.logger.error).not.toHaveBeenCalled();
		expect(Notice).not.toHaveBeenCalled();
	});

	it('logs and shows a Notice when saveSettings rejects', async () => {
		const plugin = makePlugin();
		const error = new Error('disk full');
		plugin.saveSettings.mockRejectedValueOnce(error);
		const save = createDebouncedSave(plugin as any) as Debounced;

		save();
		save.run();
		await flush();

		expect(plugin.logger.error).toHaveBeenCalledWith('Failed to save settings:', error);
		expect(Notice).toHaveBeenCalledWith('settings.common.saveFailedNotice:disk full');
	});

	it('uses the custom logLabel on failure', async () => {
		const plugin = makePlugin();
		const error = new Error('nope');
		plugin.saveSettings.mockRejectedValueOnce(error);
		const save = createDebouncedSave(plugin as any, 'Failed to save RAG settings:') as Debounced;

		save();
		save.run();
		await flush();

		expect(plugin.logger.error).toHaveBeenCalledWith('Failed to save RAG settings:', error);
	});
});
