import { describe, it, expect } from 'vitest';
import { isSameSession } from '../../../src/ui/agent-view/session-identity';
import { SessionType, type ChatSession } from '../../../src/types/agent';

function makeSession(overrides: Partial<ChatSession>): ChatSession {
	return {
		id: 'id-1',
		type: SessionType.AGENT_SESSION,
		title: 'Session',
		context: {} as ChatSession['context'],
		created: new Date(0),
		lastActive: new Date(0),
		historyPath: 'History/session-1.md',
		...overrides,
	};
}

describe('isSameSession', () => {
	it('returns false when there is no current session', () => {
		expect(isSameSession(makeSession({}), null)).toBe(false);
	});

	it('matches on identical id', () => {
		const a = makeSession({ id: 'same', historyPath: 'a.md' });
		const b = makeSession({ id: 'same', historyPath: 'b.md' });
		expect(isSameSession(a, b)).toBe(true);
	});

	it('matches on identical history path even when ids differ', () => {
		const a = makeSession({ id: 'x', historyPath: 'shared.md' });
		const b = makeSession({ id: 'y', historyPath: 'shared.md' });
		expect(isSameSession(a, b)).toBe(true);
	});

	it('returns false when both id and history path differ', () => {
		const a = makeSession({ id: 'x', historyPath: 'a.md' });
		const b = makeSession({ id: 'y', historyPath: 'b.md' });
		expect(isSameSession(a, b)).toBe(false);
	});
});
