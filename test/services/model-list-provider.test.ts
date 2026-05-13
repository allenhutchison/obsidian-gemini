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
});
