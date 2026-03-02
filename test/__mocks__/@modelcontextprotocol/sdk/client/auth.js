// Jest mock for @modelcontextprotocol/sdk/client/auth.js

class UnauthorizedError extends Error {
	constructor(message) {
		super(message ?? 'Unauthorized');
		this.name = 'UnauthorizedError';
	}
}

module.exports = {
	UnauthorizedError,
};
