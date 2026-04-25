// Wired into vitest.config.ts via resolve.alias to prevent import failures.

export class UnauthorizedError extends Error {
	constructor(message) {
		super(message ?? 'Unauthorized');
		this.name = 'UnauthorizedError';
	}
}
