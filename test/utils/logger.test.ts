import type { MockInstance } from 'vitest';
import { Logger } from '../../src/utils/logger';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
}));

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		settings: {
			debugMode: false,
			...overrides.settings,
		},
		fileLogWriter: overrides.fileLogWriter ?? null,
	};
}

describe('Logger', () => {
	let consoleSpy: Record<string, MockInstance>;

	beforeEach(() => {
		consoleSpy = {
			log: vi.spyOn(console, 'log').mockImplementation(() => {}),
			debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
			error: vi.spyOn(console, 'error').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('console output', () => {
		it('should output log() to console when debugMode is on', () => {
			const plugin = createMockPlugin({ settings: { debugMode: true } });
			const logger = new Logger(plugin);

			logger.log('test message');

			expect(consoleSpy.log).toHaveBeenCalledWith('[Gemini Scribe]', 'test message');
		});

		it('should suppress log() when debugMode is off', () => {
			const plugin = createMockPlugin({ settings: { debugMode: false } });
			const logger = new Logger(plugin);

			logger.log('test message');

			expect(consoleSpy.log).not.toHaveBeenCalled();
		});

		it('should output debug() to console when debugMode is on', () => {
			const plugin = createMockPlugin({ settings: { debugMode: true } });
			const logger = new Logger(plugin);

			logger.debug('debug info');

			expect(consoleSpy.debug).toHaveBeenCalledWith('[Gemini Scribe]', 'debug info');
		});

		it('should suppress debug() when debugMode is off', () => {
			const plugin = createMockPlugin({ settings: { debugMode: false } });
			const logger = new Logger(plugin);

			logger.debug('debug info');

			expect(consoleSpy.debug).not.toHaveBeenCalled();
		});

		it('should always output error()', () => {
			const plugin = createMockPlugin({ settings: { debugMode: false } });
			const logger = new Logger(plugin);

			logger.error('error message');

			expect(consoleSpy.error).toHaveBeenCalledWith('[Gemini Scribe]', 'error message');
		});

		it('should always output warn()', () => {
			const plugin = createMockPlugin({ settings: { debugMode: false } });
			const logger = new Logger(plugin);

			logger.warn('warning message');

			expect(consoleSpy.warn).toHaveBeenCalledWith('[Gemini Scribe]', 'warning message');
		});
	});

	describe('file log writer integration', () => {
		it('should call fileLogWriter.write() for log() when debugMode is on', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: true },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);

			logger.log('file test');

			expect(mockWriter.write).toHaveBeenCalledWith('LOG', '[Gemini Scribe]', ['file test']);
		});

		it('should not call fileLogWriter.write() for log() when debugMode is off', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: false },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);

			logger.log('file test');

			expect(mockWriter.write).not.toHaveBeenCalled();
		});

		it('should call fileLogWriter.write() for debug() when debugMode is on', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: true },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);

			logger.debug('debug file test');

			expect(mockWriter.write).toHaveBeenCalledWith('DEBUG', '[Gemini Scribe]', ['debug file test']);
		});

		it('should always call fileLogWriter.write() for error()', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: false },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);

			logger.error('error test');

			expect(mockWriter.write).toHaveBeenCalledWith('ERROR', '[Gemini Scribe]', ['error test']);
		});

		it('should always call fileLogWriter.write() for warn()', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: false },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);

			logger.warn('warn test');

			expect(mockWriter.write).toHaveBeenCalledWith('WARN', '[Gemini Scribe]', ['warn test']);
		});

		it('should handle fileLogWriter being null gracefully', () => {
			const plugin = createMockPlugin({ fileLogWriter: null });
			const logger = new Logger(plugin);

			// Should not throw
			expect(() => {
				logger.error('safe test');
				logger.warn('safe test');
			}).not.toThrow();
		});
	});

	describe('child()', () => {
		it('should create a child logger with concatenated prefix', () => {
			const plugin = createMockPlugin({ settings: { debugMode: true } });
			const logger = new Logger(plugin);
			const child = logger.child('[MCP]');

			child.log('child message');

			expect(consoleSpy.log).toHaveBeenCalledWith('[Gemini Scribe] [MCP]', 'child message');
		});

		it('should share the same fileLogWriter via plugin reference', () => {
			const mockWriter = { write: vi.fn() };
			const plugin = createMockPlugin({
				settings: { debugMode: true },
				fileLogWriter: mockWriter,
			});
			const logger = new Logger(plugin);
			const child = logger.child('[EventBus]');

			child.error('child error');

			expect(mockWriter.write).toHaveBeenCalledWith('ERROR', '[Gemini Scribe] [EventBus]', ['child error']);
		});
	});
});
