import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { ModelListProvider } from '../../src/services/model-list-provider';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = (overrides: Partial<{ provider: string }> = {}) =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: {
			provider: 'gemini',
			...overrides,
		},
		saveData: vi.fn().mockResolvedValue(undefined),
	}) as any;

describe('ModelListProvider.startRemoteFetch', () => {
	let originalDescriptor: PropertyDescriptor | undefined;

	beforeEach(() => {
		mockedRequestUrl.mockReset();
		// Capture the existing onLine descriptor so we can restore it between tests.
		originalDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
	});

	afterEach(() => {
		if (originalDescriptor) {
			Object.defineProperty(window.navigator, 'onLine', originalDescriptor);
		} else {
			// In jsdom, navigator.onLine is inherited from Navigator.prototype, so
			// getOwnPropertyDescriptor returns undefined. setOnline() then installs an
			// own property that would leak across tests if we didn't delete it here.
			delete (window.navigator as { onLine?: boolean }).onLine;
		}
	});

	const setOnline = (value: boolean) => {
		Object.defineProperty(window.navigator, 'onLine', {
			configurable: true,
			get: () => value,
		});
	};

	it('skips the remote fetch when the active provider is not gemini', () => {
		const plugin = buildPlugin({ provider: 'ollama' });
		setOnline(true);

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(plugin.logger.debug).toHaveBeenCalledWith(
			expect.stringContaining('Skipping remote fetch (provider=ollama)')
		);
	});

	it('skips the remote fetch when navigator reports offline', () => {
		const plugin = buildPlugin();
		setOnline(false);

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(plugin.logger.debug).toHaveBeenCalledWith(expect.stringContaining('navigator reports offline'));
	});

	it('issues the remote fetch when provider is gemini and the host is online', async () => {
		const plugin = buildPlugin();
		setOnline(true);
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: { version: 1, lastUpdated: '2026-05-11', models: [{ value: 'gemini-flash-latest', label: 'Flash' }] },
		});

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		// fetch is fire-and-forget — give the microtask queue a tick to flush
		await new Promise((resolve) => setImmediate(resolve));

		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
		expect(mockedRequestUrl.mock.calls[0][0].url).toContain('models.json');
	});

	it('treats a missing provider setting as gemini (legacy installs)', async () => {
		const plugin = {
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			settings: {}, // no provider field at all
			saveData: vi.fn().mockResolvedValue(undefined),
		} as any;
		setOnline(true);
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: { version: 1, lastUpdated: '2026-05-11', models: [{ value: 'gemini-flash-latest', label: 'Flash' }] },
		});

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		await new Promise((resolve) => setImmediate(resolve));

		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('skips the remote fetch when cache is still fresh', () => {
		const plugin = buildPlugin();
		setOnline(true);
		plugin.settings.remoteModelCache = {
			models: [{ value: 'cached-model', label: 'Cached' }],
			timestamp: Date.now(), // cache just set — still within 24h window
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();
		provider.startRemoteFetch();

		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(plugin.logger.debug).toHaveBeenCalledWith(expect.stringContaining('cache still fresh'));
	});
});

describe('ModelListProvider.initialize', () => {
	it('loads cached remote models from plugin settings', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = {
			models: [{ value: 'cached-flash', label: 'Flash (Cached)' }],
			timestamp: Date.now() - 1000,
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		expect(provider.getModels()).toEqual([{ value: 'cached-flash', label: 'Flash (Cached)' }]);
	});

	it('falls back to bundled models when no cache exists', () => {
		const plugin = buildPlugin();
		// no remoteModelCache set

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		// Should return bundled models (from the JSON import)
		const models = provider.getModels();
		expect(models.length).toBeGreaterThan(0);
	});

	it('falls back to bundled models when cache has no models field', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = { timestamp: Date.now() };

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		// Should not have loaded remote models
		const models = provider.getModels();
		expect(models.length).toBeGreaterThan(0);
	});
});

describe('ModelListProvider.getModels / getTextModels / getImageModels', () => {
	it('getTextModels excludes image generation models', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = {
			models: [
				{ value: 'text-model', label: 'Text', supportsImageGeneration: false },
				{ value: 'image-model', label: 'Image', supportsImageGeneration: true },
				{ value: 'plain-model', label: 'Plain' }, // no supportsImageGeneration field
			],
			timestamp: Date.now(),
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		const textModels = provider.getTextModels();
		expect(textModels.every((m) => m.supportsImageGeneration !== true)).toBe(true);
		expect(textModels.map((m) => m.value)).toContain('text-model');
		expect(textModels.map((m) => m.value)).toContain('plain-model');
		expect(textModels.map((m) => m.value)).not.toContain('image-model');
	});

	it('getImageModels returns only image generation models', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = {
			models: [
				{ value: 'text-model', label: 'Text' },
				{ value: 'image-model', label: 'Image', supportsImageGeneration: true },
			],
			timestamp: Date.now(),
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		const imageModels = provider.getImageModels();
		expect(imageModels).toHaveLength(1);
		expect(imageModels[0].value).toBe('image-model');
	});
});

describe('ModelListProvider.getMaxTemperature', () => {
	it('returns the maxTemperature for a known model', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = {
			models: [{ value: 'precise-model', label: 'Precise', maxTemperature: 1.5 }],
			timestamp: Date.now(),
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		expect(provider.getMaxTemperature('precise-model')).toBe(1.5);
	});

	it('returns 2 as default when model is not found', () => {
		const plugin = buildPlugin();

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		expect(provider.getMaxTemperature('nonexistent-model')).toBe(2);
	});

	it('returns 2 as default when model has no maxTemperature', () => {
		const plugin = buildPlugin();
		plugin.settings.remoteModelCache = {
			models: [{ value: 'no-temp-model', label: 'No Temp' }],
			timestamp: Date.now(),
		};

		const provider = new ModelListProvider(plugin);
		provider.initialize();

		expect(provider.getMaxTemperature('no-temp-model')).toBe(2);
	});
});

describe('ModelListProvider.fetchRemoteModels error handling', () => {
	let originalDescriptor: PropertyDescriptor | undefined;

	beforeEach(() => {
		mockedRequestUrl.mockReset();
		originalDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
	});

	afterEach(() => {
		if (originalDescriptor) {
			Object.defineProperty(window.navigator, 'onLine', originalDescriptor);
		} else {
			delete (window.navigator as { onLine?: boolean }).onLine;
		}
	});

	const setOnline = (value: boolean) => {
		Object.defineProperty(window.navigator, 'onLine', {
			configurable: true,
			get: () => value,
		});
	};

	it('logs a warning when the fetch returns a non-200 status', async () => {
		const plugin = buildPlugin();
		setOnline(true);
		mockedRequestUrl.mockResolvedValue({ status: 500, json: {} });

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		await new Promise((resolve) => setImmediate(resolve));

		expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Remote fetch failed'), expect.any(Error));
	});

	it('logs a warning when the response has an invalid schema (no models array)', async () => {
		const plugin = buildPlugin();
		setOnline(true);
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: { version: 'not-a-number', models: [] },
		});

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		await new Promise((resolve) => setImmediate(resolve));

		expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Remote fetch failed'), expect.any(Error));
	});

	it('still updates models even when saveData fails', async () => {
		const plugin = buildPlugin();
		setOnline(true);
		plugin.saveData.mockRejectedValue(new Error('Settings save failed'));
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: { version: 1, lastUpdated: '2026-05-14', models: [{ value: 'remote-model', label: 'Remote' }] },
		});

		const provider = new ModelListProvider(plugin);
		provider.startRemoteFetch();

		await new Promise((resolve) => setImmediate(resolve));

		// Models should still be updated in memory even though save failed
		expect(provider.getModels()).toEqual([{ value: 'remote-model', label: 'Remote' }]);
		expect(plugin.logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to persist remote cache'),
			expect.any(Error)
		);
	});
});
