import { generateToolDescription } from '../../src/utils/text-generation';
import type ObsidianGemini from '../../src/main';

describe('text-generation utils', () => {
	let mockLogger: { debug: any };
	let mockPlugin: ObsidianGemini;

	beforeEach(() => {
		mockLogger = {
			debug: vi.fn(),
		};
		mockPlugin = {
			logger: mockLogger,
		} as unknown as ObsidianGemini;
	});

	test('returns the default fallback executing description', () => {
		const result = generateToolDescription(mockPlugin, 'read_file', { path: 'note.md' }, 'Read File');
		expect(result).toBe('Executing: Read File');

		// It should log the debug warning instructing developer to add getProgressDescription
		expect(mockLogger.debug).toHaveBeenCalledWith(
			"Using fallback tool description for 'read_file'. Consider adding getProgressDescription to this tool."
		);
	});

	test('handles null/undefined arguments gracefully', () => {
		const result = generateToolDescription(mockPlugin, 'read_file', null as any, 'Read File');
		expect(result).toBe('Executing: Read File');
	});

	test('falls back gracefully and logs when plugin logger throws', () => {
		// If the logger throws for some reason, it should still return the fallback string
		const brokenLogger = {
			debug: vi.fn().mockImplementation(() => {
				throw new Error('logger crash');
			}),
		};
		const brokenPlugin = {
			logger: brokenLogger,
		} as unknown as ObsidianGemini;

		const result = generateToolDescription(brokenPlugin, 'read_file', {}, 'Read File');
		expect(result).toBe('Executing: Read File');
		// Second debug call attempts to log the crash, but that also throws and gets caught.
		expect(brokenLogger.debug).toHaveBeenCalledTimes(2);
	});
});
