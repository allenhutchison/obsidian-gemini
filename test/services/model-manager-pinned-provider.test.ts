import { ModelManager } from '../../src/services/model-manager';
import {
	GeminiModel,
	GEMINI_MODELS,
	setGeminiModels,
	getDefaultModelForRole,
	findModelProvider,
} from '../../src/models';
import type { ModelProvider } from '../../src/models';

// Which providers read as connected, per test.
let connected: Set<ModelProvider> = new Set();
vi.mock('../../src/api/provider-status', () => ({
	providerConnection: (_plugin: unknown, p: ModelProvider) => (connected.has(p) ? 'connected' : 'unknown'),
}));

const gemini: GeminiModel = { value: 'gemini-test', label: 'Gemini test', defaultForRoles: ['chat'] };
const claude: GeminiModel = {
	value: 'claude-test',
	label: 'Claude test',
	provider: 'anthropic',
	defaultForRoles: ['chat'],
};
const llama: GeminiModel = { value: 'llama-test', label: 'Llama test', provider: 'ollama' };

function makePlugin() {
	return {
		settings: {
			defaultProvider: 'gemini',
			features: { chat: { provider: 'gemini', model: '' } },
		},
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
	} as any;
}

function stubServices(manager: ModelManager, lists: Partial<Record<ModelProvider, GeminiModel[] | Error>>) {
	const calls: ModelProvider[] = [];
	vi.spyOn(manager, 'getProviderModelsService').mockImplementation(
		(p: ModelProvider) =>
			({
				lastProbe: 'reachable',
				getModels: vi.fn(async () => {
					calls.push(p);
					const list = lists[p];
					if (list instanceof Error) throw list;
					return list ?? [];
				}),
			}) as any
	);
	return calls;
}

describe('ModelManager: models for pinned session providers (#1679)', () => {
	let original: GeminiModel[];

	beforeEach(() => {
		original = [...GEMINI_MODELS];
		connected = new Set();
	});

	afterEach(() => {
		setGeminiModels(original);
	});

	it('loads a connected provider no feature routes to, so its default model resolves', async () => {
		connected = new Set(['gemini', 'anthropic']);
		const manager = new ModelManager(makePlugin());
		stubServices(manager, { gemini: [gemini], anthropic: [claude] });

		await manager.initialize();

		expect(getDefaultModelForRole('chat', 'anthropic')).toBe('claude-test');
		expect(findModelProvider('claude-test')).toBe('anthropic');
	});

	it('skips unrouted providers that are not connected at startup', async () => {
		connected = new Set(['gemini']);
		const manager = new ModelManager(makePlugin());
		const calls = stubServices(manager, { gemini: [gemini], ollama: [llama] });

		await manager.initialize();

		expect(calls).toEqual(['gemini']);
		expect(getDefaultModelForRole('chat', 'ollama')).toBe('');
	});

	it('ensureProviderModels merges a missing provider into the list, keeping the rest', async () => {
		const manager = new ModelManager(makePlugin());
		stubServices(manager, { gemini: [gemini], ollama: [llama] });
		setGeminiModels([gemini]);

		await manager.ensureProviderModels('ollama');

		expect(GEMINI_MODELS.map((m) => m.value)).toEqual(['gemini-test', 'llama-test']);
		expect(getDefaultModelForRole('chat', 'ollama')).toBe('llama-test');
	});

	it('ensureProviderModels does nothing when the provider is already listed', async () => {
		const manager = new ModelManager(makePlugin());
		const calls = stubServices(manager, { anthropic: [claude] });
		setGeminiModels([gemini, claude]);

		await manager.ensureProviderModels('anthropic');

		expect(calls).toEqual([]);
	});

	it('ensureProviderModels leaves the list alone when the load fails', async () => {
		const plugin = makePlugin();
		const manager = new ModelManager(plugin);
		stubServices(manager, { ollama: new Error('ECONNREFUSED') });
		setGeminiModels([gemini]);

		await manager.ensureProviderModels('ollama');

		expect(GEMINI_MODELS.map((m) => m.value)).toEqual(['gemini-test']);
		expect(plugin.logger.warn).toHaveBeenCalled();
	});
});
