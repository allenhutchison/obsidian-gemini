import { describe, it, expect } from 'vitest';
import { explainMCPConnectionError } from '../../src/mcp/mcp-errors';

// Verbatim shape of the SDK's parseErrorResponse message from #1597.
const WISESHEETS_403 =
	'HTTP 403: Invalid OAuth error response: SyntaxError: Unexpected token \'<\', "<html> <h"... is not valid JSON. ' +
	'Raw body: <html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> </body> </html>';

describe('explainMCPConnectionError', () => {
	it('explains an OAuth endpoint that answered with an HTML page (#1597)', () => {
		const explained = explainMCPConnectionError(new Error(WISESHEETS_403));
		expect(explained).toContain('HTTP 403');
		expect(explained).toContain('firewall');
		expect(explained).not.toContain('SyntaxError');
	});

	it('recognises doctype, comment, head and body-led HTML bodies and a missing status', () => {
		const doctype = 'Invalid OAuth error response: SyntaxError: x. Raw body: <!DOCTYPE html><html></html>';
		expect(explainMCPConnectionError(new Error(doctype))).toContain('HTTP ?');
		const comment = 'HTTP 502: Invalid OAuth error response: SyntaxError: x. Raw body: <!-- padding --><html>';
		expect(explainMCPConnectionError(comment)).toContain('HTTP 502');
		const headFirst =
			'HTTP 403: Invalid OAuth error response: SyntaxError: x. Raw body: <head><title>403</title></head>';
		expect(explainMCPConnectionError(new Error(headFirst))).toContain('HTTP 403');
		const bodyFirst = 'HTTP 403: Invalid OAuth error response: SyntaxError: x. Raw body: <body>Forbidden</body>';
		expect(explainMCPConnectionError(new Error(bodyFirst))).toContain('HTTP 403');
	});

	it('leaves non-HTML OAuth parse failures and other errors to the caller', () => {
		expect(
			explainMCPConnectionError(new Error('HTTP 400: Invalid OAuth error response: ZodError. Raw body: {"foo":1}'))
		).toBeNull();
		expect(explainMCPConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:3000'))).toBeNull();
		expect(explainMCPConnectionError(undefined)).toBeNull();
	});
});
