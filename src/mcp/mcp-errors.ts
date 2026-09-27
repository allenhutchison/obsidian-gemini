import { t } from '../i18n';

/**
 * The MCP SDK's `parseErrorResponse` (client/auth.js) wraps any OAuth endpoint
 * reply it cannot parse as `HTTP <status>: Invalid OAuth error response: <JSON
 * parse error>. Raw body: <body>`. When the body is an HTML page, the reply
 * most likely came from a proxy or firewall in front of the OAuth server, not
 * from the server itself (#1597 was a firewall rejecting the loopback redirect
 * URI). The raw message ("SyntaxError: Unexpected token '<'") reads like a
 * plugin bug and sent that user's diagnosis in the wrong direction, so this
 * case gets a plain-language explanation.
 */
const OAUTH_HTML_RESPONSE =
	/^(?:HTTP (\d{3}): )?Invalid OAuth error response:[\s\S]*?Raw body:\s*<(?:!doctype|html|!--)/i;

/**
 * Explain an MCP connection error in terms a user can act on, or return
 * `null` when there is nothing better to say than the caller's own fallback.
 */
export function explainMCPConnectionError(error: unknown): string | null {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	const match = OAUTH_HTML_RESPONSE.exec(message);
	if (!match) return null;
	return t('mcpServer.oauthHtmlResponse', { status: match[1] ?? '?' });
}
