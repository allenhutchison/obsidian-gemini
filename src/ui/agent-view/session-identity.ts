import type { ChatSession } from '../../types/agent';

/**
 * Check whether `session` refers to the same session as `currentSession`.
 *
 * Compares both the session ID and the history path for robustness: a session
 * can be re-loaded from disk with a fresh in-memory identity, so matching either
 * field is treated as the same session. Returns `false` when there is no current
 * session.
 */
export function isSameSession(session: ChatSession, currentSession: ChatSession | null): boolean {
	if (!currentSession) return false;
	return session.id === currentSession.id || session.historyPath === currentSession.historyPath;
}
