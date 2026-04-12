import { buildTurnPreamble, stripTurnPreamble } from '../../src/utils/turn-preamble';

describe('turn-preamble', () => {
	describe('buildTurnPreamble', () => {
		it('wraps the timestamp in the canonical preamble format', () => {
			const preamble = buildTurnPreamble('2026-04-12T14:23:45.123-07:00');
			expect(preamble).toBe('[Current date and time: 2026-04-12T14:23:45.123-07:00]\n\n');
		});
	});

	describe('stripTurnPreamble', () => {
		it('strips a well-formed preamble from the start of the message', () => {
			const message = '[Current date and time: 2026-04-12T14:23:45.123-07:00]\n\nHello, can you summarize my notes?';
			expect(stripTurnPreamble(message)).toBe('Hello, can you summarize my notes?');
		});

		it('is a no-op when the message has no preamble', () => {
			const message = 'Hello, can you summarize my notes?';
			expect(stripTurnPreamble(message)).toBe(message);
		});

		it('leaves malformed preambles intact — never over-strips', () => {
			const cases = [
				// Missing closing bracket
				'[Current date and time: 2026-04-12T14:23:45.123-07:00\n\nHello',
				// Wrong header text
				'[Timestamp: 2026-04-12T14:23:45.123-07:00]\n\nHello',
				// Preamble buried inside the message, not at the start
				'Hello [Current date and time: 2026-04-12T14:23:45.123-07:00]\n\nWorld',
				// Single newline separator instead of the required blank line
				'[Current date and time: 2026-04-12T14:23:45.123-07:00]\nHello',
			];
			for (const msg of cases) {
				expect(stripTurnPreamble(msg)).toBe(msg);
			}
		});

		it('build then strip round-trips to the original message', () => {
			const original = 'What did I write about caching last week?';
			const preamble = buildTurnPreamble('2026-04-12T14:23:45.123-07:00');
			expect(stripTurnPreamble(preamble + original)).toBe(original);
		});
	});
});
