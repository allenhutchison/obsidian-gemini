import type { App } from 'obsidian';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientMetadata,
	OAuthTokens,
	OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/** Port for the local OAuth callback server */
export const OAUTH_CALLBACK_PORT = 8095;

/** Base redirect URL for the OAuth flow */
export const OAUTH_REDIRECT_URL = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

/** Prefix for secret storage keys */
const SECRET_KEY_TOKENS_PREFIX = 'mcp-oauth-tokens-';
const SECRET_KEY_CLIENT_PREFIX = 'mcp-oauth-client-';

/**
 * Sanitize a server name into a valid SecretStorage key segment.
 * Keys must be lowercase alphanumeric with optional dashes.
 */
export function sanitizeKeySegment(name: string): string {
	const sanitized = name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return sanitized || 'unnamed';
}

/**
 * OAuthClientProvider for Obsidian MCP servers.
 *
 * Persists tokens and client info in Obsidian's SecretStorage (OS keychain).
 * PKCE code verifier is stored in-memory (transient per session).
 */
export class ObsidianOAuthClientProvider implements OAuthClientProvider {
	private app: App;
	private serverName: string;
	private _codeVerifier?: string;

	/** Secret key for OAuth tokens */
	private get tokensKey(): string {
		return `${SECRET_KEY_TOKENS_PREFIX}${sanitizeKeySegment(this.serverName)}`;
	}

	/** Secret key for client registration info */
	private get clientKey(): string {
		return `${SECRET_KEY_CLIENT_PREFIX}${sanitizeKeySegment(this.serverName)}`;
	}

	constructor(app: App, serverName: string) {
		this.app = app;
		this.serverName = serverName;
	}

	get redirectUrl(): string {
		return OAUTH_REDIRECT_URL;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'Obsidian Gemini Scribe',
			redirect_uris: [OAUTH_REDIRECT_URL],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			// Public client — no client secret (uses PKCE for security)
			token_endpoint_auth_method: 'none',
		};
	}

	clientInformation(): OAuthClientInformationFull | undefined {
		const raw = this.app.secretStorage.getSecret(this.clientKey);
		if (!raw) return undefined;
		try {
			return JSON.parse(raw) as OAuthClientInformationFull;
		} catch {
			return undefined;
		}
	}

	saveClientInformation(clientInformation: OAuthClientInformationFull): void {
		this.app.secretStorage.setSecret(this.clientKey, JSON.stringify(clientInformation));
	}

	tokens(): OAuthTokens | undefined {
		const raw = this.app.secretStorage.getSecret(this.tokensKey);
		if (!raw) return undefined;
		try {
			return JSON.parse(raw) as OAuthTokens;
		} catch {
			return undefined;
		}
	}

	saveTokens(tokens: OAuthTokens): void {
		this.app.secretStorage.setSecret(this.tokensKey, JSON.stringify(tokens));
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		// Open in the user's default system browser
		window.open(authorizationUrl.toString());
	}

	saveCodeVerifier(codeVerifier: string): void {
		this._codeVerifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this._codeVerifier) {
			throw new Error('No PKCE code verifier saved for this session');
		}
		return this._codeVerifier;
	}

	/**
	 * Check whether this provider has stored tokens.
	 */
	hasTokens(): boolean {
		const raw = this.app.secretStorage.getSecret(this.tokensKey);
		return !!raw;
	}

	/**
	 * Clear all stored OAuth credentials for this server.
	 */
	invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): void {
		if (scope === 'all' || scope === 'tokens') {
			this.app.secretStorage.setSecret(this.tokensKey, '');
		}
		if (scope === 'all' || scope === 'client') {
			this.app.secretStorage.setSecret(this.clientKey, '');
		}
		if (scope === 'all' || scope === 'verifier') {
			this._codeVerifier = undefined;
		}
	}

	/**
	 * Clear all OAuth secrets for this server (convenience method).
	 */
	clearAll(): void {
		this.invalidateCredentials('all');
	}
}
