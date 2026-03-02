import { ObsidianOAuthClientProvider, sanitizeKeySegment, OAUTH_REDIRECT_URL } from '../../src/mcp/mcp-oauth-provider';

// Mock Obsidian's App with SecretStorage
function createMockApp() {
	const secrets = new Map<string, string>();
	return {
		secretStorage: {
			getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
			setSecret: jest.fn((id: string, value: string) => {
				if (value === '') {
					secrets.delete(id);
				} else {
					secrets.set(id, value);
				}
			}),
			listSecrets: jest.fn(() => Array.from(secrets.keys())),
		},
	} as any;
}

describe('sanitizeKeySegment', () => {
	it('should lowercase and replace non-alphanumeric chars with dashes', () => {
		expect(sanitizeKeySegment('My Server')).toBe('my-server');
	});

	it('should collapse multiple dashes', () => {
		expect(sanitizeKeySegment('a--b---c')).toBe('a-b-c');
	});

	it('should strip leading and trailing dashes', () => {
		expect(sanitizeKeySegment('-test-')).toBe('test');
	});

	it('should handle special characters', () => {
		expect(sanitizeKeySegment('server@v2.0!')).toBe('server-v2-0');
	});

	it('should handle already-valid names', () => {
		expect(sanitizeKeySegment('my-server-1')).toBe('my-server-1');
	});

	it('should produce deterministic hash-based keys when all chars are stripped', () => {
		const result1 = sanitizeKeySegment('!!!');
		const result2 = sanitizeKeySegment('***');
		const result3 = sanitizeKeySegment('');

		// Each should start with 'server-' prefix
		expect(result1).toMatch(/^server-[a-z0-9]+$/);
		expect(result2).toMatch(/^server-[a-z0-9]+$/);
		expect(result3).toMatch(/^server-[a-z0-9]+$/);

		// Different inputs should produce different keys
		expect(result1).not.toBe(result2);

		// Same input should produce same key (deterministic)
		expect(sanitizeKeySegment('!!!')).toBe(result1);
	});
});

describe('ObsidianOAuthClientProvider', () => {
	let app: ReturnType<typeof createMockApp>;
	let provider: ObsidianOAuthClientProvider;

	beforeEach(() => {
		app = createMockApp();
		provider = new ObsidianOAuthClientProvider(app, 'test-server');
	});

	describe('redirectUrl', () => {
		it('should return the callback URL', () => {
			expect(provider.redirectUrl).toBe(OAUTH_REDIRECT_URL);
		});
	});

	describe('clientMetadata', () => {
		it('should return valid OAuth client metadata', () => {
			const meta = provider.clientMetadata;
			expect(meta.client_name).toBe('Obsidian Gemini Scribe');
			expect(meta.redirect_uris).toEqual([OAUTH_REDIRECT_URL]);
			expect(meta.grant_types).toContain('authorization_code');
			expect(meta.grant_types).toContain('refresh_token');
			expect(meta.response_types).toContain('code');
		});
	});

	describe('token persistence', () => {
		it('should return undefined when no tokens stored', () => {
			expect(provider.tokens()).toBeUndefined();
		});

		it('should save and load tokens', () => {
			const tokens = {
				access_token: 'test-access-token',
				token_type: 'bearer',
				refresh_token: 'test-refresh-token',
			};

			provider.saveTokens(tokens as any);
			expect(app.secretStorage.setSecret).toHaveBeenCalledWith('mcp-oauth-tokens-test-server', JSON.stringify(tokens));

			const loaded = provider.tokens();
			expect(loaded).toEqual(tokens);
		});

		it('should return undefined for invalid JSON', () => {
			app.secretStorage.getSecret.mockReturnValueOnce('not-json');
			expect(provider.tokens()).toBeUndefined();
		});
	});

	describe('client info persistence', () => {
		it('should return undefined when no client info stored', () => {
			expect(provider.clientInformation()).toBeUndefined();
		});

		it('should save and load client info', () => {
			const info = {
				client_id: 'test-client-id',
				client_secret: 'test-secret',
			};

			provider.saveClientInformation(info as any);
			expect(app.secretStorage.setSecret).toHaveBeenCalledWith('mcp-oauth-client-test-server', JSON.stringify(info));

			const loaded = provider.clientInformation();
			expect(loaded).toEqual(info);
		});

		it('should return undefined for invalid JSON', () => {
			app.secretStorage.getSecret.mockReturnValueOnce('{invalid');
			expect(provider.clientInformation()).toBeUndefined();
		});
	});

	describe('PKCE code verifier', () => {
		it('should throw when no verifier saved', () => {
			expect(() => provider.codeVerifier()).toThrow('No PKCE code verifier');
		});

		it('should save and retrieve verifier', () => {
			provider.saveCodeVerifier('test-verifier-123');
			expect(provider.codeVerifier()).toBe('test-verifier-123');
		});
	});

	describe('hasTokens', () => {
		it('should return false when no tokens', () => {
			expect(provider.hasTokens()).toBe(false);
		});

		it('should return true when tokens exist', () => {
			provider.saveTokens({ access_token: 'tok', token_type: 'bearer' } as any);
			expect(provider.hasTokens()).toBe(true);
		});
	});

	describe('invalidateCredentials', () => {
		beforeEach(() => {
			provider.saveTokens({ access_token: 'tok', token_type: 'bearer' } as any);
			provider.saveClientInformation({ client_id: 'cid' } as any);
			provider.saveCodeVerifier('verifier');
		});

		it('should clear only tokens', () => {
			provider.invalidateCredentials('tokens');
			expect(provider.hasTokens()).toBe(false);
			expect(provider.clientInformation()).toBeDefined();
			expect(provider.codeVerifier()).toBe('verifier');
		});

		it('should clear only client info', () => {
			provider.invalidateCredentials('client');
			expect(provider.hasTokens()).toBe(true);
			expect(provider.clientInformation()).toBeUndefined();
		});

		it('should clear only verifier', () => {
			provider.invalidateCredentials('verifier');
			expect(provider.hasTokens()).toBe(true);
			expect(() => provider.codeVerifier()).toThrow();
		});

		it('should clear everything on "all"', () => {
			provider.invalidateCredentials('all');
			expect(provider.hasTokens()).toBe(false);
			expect(provider.clientInformation()).toBeUndefined();
			expect(() => provider.codeVerifier()).toThrow();
		});
	});

	describe('clearAll', () => {
		it('should clear all credentials', () => {
			provider.saveTokens({ access_token: 'tok', token_type: 'bearer' } as any);
			provider.saveClientInformation({ client_id: 'cid' } as any);

			provider.clearAll();
			expect(provider.hasTokens()).toBe(false);
			expect(provider.clientInformation()).toBeUndefined();
		});
	});

	describe('redirectToAuthorization', () => {
		it('should open browser with URL', () => {
			const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
			const url = new URL('https://auth.example.com/authorize?client_id=test');

			provider.redirectToAuthorization(url);

			expect(openSpy).toHaveBeenCalledWith(url.toString());
			openSpy.mockRestore();
		});
	});
});
