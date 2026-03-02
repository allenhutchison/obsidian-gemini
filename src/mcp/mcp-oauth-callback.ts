import { createServer, IncomingMessage, ServerResponse } from 'http';
import { OAUTH_CALLBACK_PORT } from './mcp-oauth-provider';

/** Escape untrusted values for safe HTML embedding. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Default timeout for the callback server (2 minutes) */
const CALLBACK_TIMEOUT_MS = 120_000;

/**
 * Result of an OAuth callback. Contains either a code or an error.
 */
export interface OAuthCallbackResult {
	code: string;
}

/**
 * Start a temporary HTTP server to receive the OAuth redirect callback.
 *
 * The server listens on 127.0.0.1:{OAUTH_CALLBACK_PORT} and waits for the
 * authorization server to redirect the user's browser with a ?code= parameter.
 * After receiving the code (or timing out), it shuts down automatically.
 *
 * This function resolves in two phases:
 * 1. `startListening()` – starts the server and resolves once it's actually
 *    listening (so the caller can safely open the browser redirect).
 * 2. The returned `waitForCode()` promise – resolves when the callback arrives.
 *
 * Desktop-only: uses Node's `http.createServer`.
 */
export interface OAuthCallbackHandle {
	/** Promise that resolves when the OAuth callback is received. */
	waitForCode: Promise<OAuthCallbackResult>;
	/** Shut down the callback server early (e.g. on cancel). */
	close: () => void;
}

/**
 * Start the callback server and wait until it is actively listening.
 * Returns a handle whose `waitForCode` promise resolves with the auth code.
 */
export async function startOAuthCallbackServer(timeoutMs = CALLBACK_TIMEOUT_MS): Promise<OAuthCallbackHandle> {
	let settled = false;
	let resolveCode: (result: OAuthCallbackResult) => void;
	let rejectCode: (err: Error) => void;

	const waitForCode = new Promise<OAuthCallbackResult>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		// Ignore favicon etc.
		if (!req.url?.startsWith('/callback')) {
			res.writeHead(404);
			res.end();
			return;
		}

		const parsedUrl = new URL(req.url, `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);
		const code = parsedUrl.searchParams.get('code');
		const error = parsedUrl.searchParams.get('error');

		if (code) {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(`<!DOCTYPE html>
<html><body style="font-family:system-ui;text-align:center;padding:40px">
<h1>✅ Authorization Successful</h1>
<p>You can close this tab and return to Obsidian.</p>
<script>setTimeout(()=>window.close(),2000)</script>
</body></html>`);

			settled = true;
			resolveCode({ code });
			setTimeout(() => server.close(), 500);
		} else {
			const errorDesc = escapeHtml(parsedUrl.searchParams.get('error_description') || error || 'Unknown error');
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(`<!DOCTYPE html>
<html><body style="font-family:system-ui;text-align:center;padding:40px">
<h1>❌ Authorization Failed</h1>
<p>${errorDesc}</p>
</body></html>`);

			settled = true;
			rejectCode(new Error(`OAuth authorization failed: ${errorDesc}`));
			setTimeout(() => server.close(), 500);
		}
	});

	// Timeout: shut down if no callback received
	const timeout = setTimeout(() => {
		if (!settled) {
			settled = true;
			server.close();
			rejectCode(new Error('OAuth callback timed out — no authorization response received'));
		}
	}, timeoutMs);

	server.on('close', () => {
		clearTimeout(timeout);
	});

	// Wait for the server to actually start listening before resolving
	await new Promise<void>((resolve, reject) => {
		server.on('error', (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				rejectCode(new Error(`OAuth callback server error: ${err.message}`));
			}
			reject(err);
		});

		server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
			resolve();
		});
	});

	return {
		waitForCode,
		close: () => {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				server.close();
				rejectCode(new Error('OAuth callback server closed'));
			}
		},
	};
}

/**
 * Convenience wrapper: start server, wait for code, return result.
 * @deprecated Use `startOAuthCallbackServer` for two-phase control.
 */
export function waitForOAuthCallback(timeoutMs = CALLBACK_TIMEOUT_MS): Promise<OAuthCallbackResult> {
	return startOAuthCallbackServer(timeoutMs).then((handle) => handle.waitForCode);
}
