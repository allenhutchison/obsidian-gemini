import { ImageGeneration } from '../../src/services/image-generation';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
}));

// The validator does not touch the network; mock the API factory so the
// constructor can run without real credentials.
vi.mock('../../src/api', () => ({
	GeminiClient: vi.fn().mockImplementation(function () {
		return {};
	}),
	GeminiClientFactory: { createSummaryModel: vi.fn() },
}));

vi.mock('../../src/prompts', () => ({
	GeminiPrompts: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

describe('ImageGeneration.validateOutputPath (output-path validator)', () => {
	let service: ImageGeneration;

	// Pin the state-folder allowlist behavior added in #724: Background-Tasks/
	// is the one allowed subtree under the plugin state folder. Reach into the
	// private method directly — its contract is what callers depend on.
	const validate = (path: string): string => (service as any).validateOutputPath(path);

	beforeEach(() => {
		const mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('allows a file under [state-folder]/Background-Tasks/ and rewrites the extension to .png', () => {
		expect(validate('gemini-scribe/Background-Tasks/foo.png')).toBe('gemini-scribe/Background-Tasks/foo.png');
		expect(validate('gemini-scribe/Background-Tasks/foo.jpg')).toBe('gemini-scribe/Background-Tasks/foo.png');
		expect(validate('gemini-scribe/Background-Tasks/foo')).toBe('gemini-scribe/Background-Tasks/foo.png');
	});

	it('rejects other subfolders under the state folder', () => {
		expect(() => validate('gemini-scribe/Skills/foo.png')).toThrow(/plugin state folder/);
		expect(() => validate('gemini-scribe/Agent-Sessions/foo.png')).toThrow(/plugin state folder/);
	});

	it('rejects sibling-prefix paths that start with Background-Tasks but are not the subfolder', () => {
		// Without the trailing-slash check, "Background-Tasks-Other/foo" would
		// sneak past startsWith('Background-Tasks') — guard that.
		expect(() => validate('gemini-scribe/Background-Tasks-Other/foo.png')).toThrow(/plugin state folder/);
	});

	it('rejects bare "Background-Tasks" because the .png rewrite leaves it outside the allowed subfolder', () => {
		// The extension rewrite happens before the state-folder check, so a bare
		// "gemini-scribe/Background-Tasks" path becomes "gemini-scribe/Background-Tasks.png"
		// which does not start with "gemini-scribe/Background-Tasks/" and is therefore rejected.
		expect(() => validate('gemini-scribe/Background-Tasks')).toThrow(/plugin state folder/);
	});

	it('rejects paths inside .obsidian/', () => {
		expect(() => validate('.obsidian/snippets/foo.png')).toThrow(/Obsidian configuration folder/);
	});

	it('rejects vault-escaping paths', () => {
		expect(() => validate('../outside.png')).toThrow(/escapes the vault/);
	});

	it('allows arbitrary paths outside the state folder and forces a .png extension', () => {
		expect(validate('attachments/foo.png')).toBe('attachments/foo.png');
		expect(validate('attachments/foo.jpg')).toBe('attachments/foo.png');
		expect(validate('attachments/foo')).toBe('attachments/foo.png');
	});
});
