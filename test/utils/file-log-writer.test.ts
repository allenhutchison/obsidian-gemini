import { FileLogWriter } from '../../src/utils/file-log-writer';

// Mock obsidian module
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	normalizePath: jest.fn((path: string) => path),
}));

// Mock format-utils to control timestamp output
jest.mock('../../src/utils/format-utils', () => ({
	formatLocalTimestamp: jest.fn(() => '2026-04-08T14:00:00.000+00:00'),
}));

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		settings: {
			historyFolder: 'gemini-scribe',
			fileLogging: true,
			debugMode: true,
			...overrides.settings,
		},
		app: {
			vault: {
				adapter: {
					exists: jest.fn().mockResolvedValue(false),
					read: jest.fn().mockResolvedValue(''),
					write: jest.fn().mockResolvedValue(undefined),
					stat: jest.fn().mockResolvedValue({ size: 0 }),
					remove: jest.fn().mockResolvedValue(undefined),
				},
				...overrides.vault,
			},
			...overrides.app,
		},
		...overrides,
	};
}

describe('FileLogWriter', () => {
	let mockPlugin: any;
	let writer: FileLogWriter;

	beforeEach(() => {
		jest.useFakeTimers();
		mockPlugin = createMockPlugin();
		writer = new FileLogWriter(mockPlugin);
	});

	afterEach(async () => {
		await writer.destroy();
		jest.useRealTimers();
	});

	describe('write()', () => {
		it('should not buffer entries when fileLogging is disabled', () => {
			mockPlugin.settings.fileLogging = false;
			writer.write('LOG', '[Gemini Scribe]', ['test message']);

			jest.advanceTimersByTime(2000);
			expect(mockPlugin.app.vault.adapter.write).not.toHaveBeenCalled();
		});

		it('should buffer entries when fileLogging is enabled', async () => {
			writer.write('LOG', '[Gemini Scribe]', ['test message']);

			// Should not write immediately
			expect(mockPlugin.app.vault.adapter.write).not.toHaveBeenCalled();

			// Advance timer to trigger flush
			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	describe('flush()', () => {
		it('should write formatted content via adapter.write()', async () => {
			writer.write('ERROR', '[Gemini Scribe]', ['something failed']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/debug.log',
				expect.stringContaining('[2026-04-08T14:00:00.000+00:00] [ERROR] [Gemini Scribe] something failed')
			);
		});

		it('should batch multiple writes into a single flush', async () => {
			writer.write('LOG', '[Gemini Scribe]', ['message 1']);
			writer.write('DEBUG', '[Gemini Scribe]', ['message 2']);
			writer.write('ERROR', '[Gemini Scribe]', ['message 3']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledTimes(1);
			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toContain('[LOG]');
			expect(writtenContent).toContain('[DEBUG]');
			expect(writtenContent).toContain('[ERROR]');
		});

		it('should append to existing file content', async () => {
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.read.mockResolvedValue('existing line\n');
			mockPlugin.app.vault.adapter.stat.mockResolvedValue({ size: 100 });

			writer.write('LOG', '[Gemini Scribe]', ['new message']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toMatch(/^existing line\n/);
			expect(writtenContent).toContain('new message');
		});

		it('should not flush when buffer is empty', async () => {
			// Don't write anything, just advance time
			jest.advanceTimersByTime(2000);
			await jest.runAllTimersAsync();

			expect(mockPlugin.app.vault.adapter.write).not.toHaveBeenCalled();
		});

		it('should handle adapter not available gracefully', async () => {
			mockPlugin.app.vault.adapter = null;

			expect(() => writer.write('ERROR', '[Gemini Scribe]', ['test'])).not.toThrow();

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Adapter was null, so no write should have occurred
			expect(mockPlugin.app.vault.adapter).toBeNull();
		});
	});

	describe('log format', () => {
		it('should include timestamp, level, prefix, and message', async () => {
			writer.write('WARN', '[Gemini Scribe] [MCP]', ['connection lost']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toBe('[2026-04-08T14:00:00.000+00:00] [WARN] [Gemini Scribe] [MCP] connection lost\n');
		});

		it('should serialize Error objects with stack traces', async () => {
			const error = new Error('test error');
			error.stack = 'Error: test error\n    at test.ts:1:1';

			writer.write('ERROR', '[Gemini Scribe]', ['Failed:', error]);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toContain('test error');
			expect(writtenContent).toContain('at test.ts:1:1');
		});

		it('should serialize objects as JSON', async () => {
			writer.write('DEBUG', '[Gemini Scribe]', ['data:', { key: 'value', count: 42 }]);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toContain('{"key":"value","count":42}');
		});

		it('should handle null and undefined args', async () => {
			writer.write('LOG', '[Gemini Scribe]', [null, undefined, 'text']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			const writtenContent = mockPlugin.app.vault.adapter.write.mock.calls[0][1];
			expect(writtenContent).toContain('null undefined text');
		});

		it('should handle circular references in objects gracefully', async () => {
			const circular: any = { a: 1 };
			circular.self = circular;

			writer.write('LOG', '[Gemini Scribe]', ['circular:', circular]);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Should not throw; falls back to String()
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	describe('rotation', () => {
		it('should rotate when file exceeds 1MB', async () => {
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.stat.mockResolvedValue({ size: 1_048_576 });
			mockPlugin.app.vault.adapter.read.mockResolvedValue('old content');

			writer.write('LOG', '[Gemini Scribe]', ['new entry']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Should have written old content to .old path
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith('gemini-scribe/debug.log.old', 'old content');
			// Should have removed the original file
			expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalledWith('gemini-scribe/debug.log');
			// Should have written the new entry to a fresh file
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/debug.log',
				expect.stringContaining('new entry')
			);
		});

		it('should remove existing .old file before rotating', async () => {
			// First call (exists check for debug.log) returns true
			// Second call within rotate (exists check for debug.log.old) returns true
			// Third call within rotate (exists check for debug.log) returns true
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.stat.mockResolvedValue({ size: 1_200_000 });
			mockPlugin.app.vault.adapter.read.mockResolvedValue('old data');

			writer.write('LOG', '[Gemini Scribe]', ['msg']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Should remove old log first
			expect(mockPlugin.app.vault.adapter.remove).toHaveBeenCalledWith('gemini-scribe/debug.log.old');
		});
	});

	describe('error handling', () => {
		it('should not propagate write errors', async () => {
			mockPlugin.app.vault.adapter.write.mockRejectedValue(new Error('disk full'));
			const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

			writer.write('LOG', '[Gemini Scribe]', ['test']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Should log error to console but not throw
			expect(consoleSpy).toHaveBeenCalledWith('[Gemini Scribe] FileLogWriter write error:', expect.any(Error));
			consoleSpy.mockRestore();
		});

		it('should not propagate rotation errors', async () => {
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.stat.mockResolvedValue({ size: 2_000_000 });
			mockPlugin.app.vault.adapter.remove.mockRejectedValue(new Error('permission denied'));
			const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

			writer.write('LOG', '[Gemini Scribe]', ['test']);

			jest.advanceTimersByTime(1100);
			await jest.runAllTimersAsync();

			// Should handle gracefully
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});

	describe('destroy()', () => {
		it('should flush remaining entries on destroy', async () => {
			writer.write('LOG', '[Gemini Scribe]', ['final message']);

			// destroy() should flush without waiting for the debounce timer
			await writer.destroy();

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/debug.log',
				expect.stringContaining('final message')
			);
		});

		it('should clear pending flush timer', async () => {
			writer.write('LOG', '[Gemini Scribe]', ['message']);

			// Timer is scheduled but not yet fired — destroy should clear it and flush
			await writer.destroy();

			// Advance timers to verify the original timer doesn't fire again
			jest.advanceTimersByTime(2000);
			await jest.runAllTimersAsync();

			// Only one write from destroy's flush, not a double write
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledTimes(1);
		});
	});
});
